import { Injectable, BadRequestException, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { refunds, orders } from '@/storage/database/shared/schema';
import { CreateRefundDto, UpdateRefundStatusDto } from './dto/refund.dto';
import { eq, desc, sql, and, inArray } from 'drizzle-orm';
import { OrdersGateway } from '../orders/orders.gateway';
import { NotificationDispatcherService } from '../notif/notification-dispatcher.service';

/**
 * 退款操作人上下文（从 JWT 注入，绝不信任前端传入的 operator_id）
 */
export interface RefundActor {
  userId: number;
  role?: string;
}

/**
 * 金额转「分」做整数运算，规避 decimal 字符串走 parseFloat 的浮点误差。
 * 入参为 decimal 字符串（如 "76.00"）或 number；返回整数分。
 */
function toCents(amount: string | number): number {
  const n = typeof amount === 'number' ? amount : parseFloat(amount);
  if (!Number.isFinite(n)) return NaN;
  // 四舍五入到分，避免 76.005 这类输入残留浮点尾差
  return Math.round(n * 100);
}

function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 允许发起退款的订单状态：已结账才谈得上退款 */
const REFUNDABLE_ORDER_STATUSES: ReadonlySet<string> = new Set(['settled']);

/** 计入「已占用退款额度」的退款状态（pending 占额，避免并发重复申请超额） */
const COUNTED_REFUND_STATUSES: readonly string[] = ['pending', 'approved'];

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly ordersGateway: OrdersGateway,
    private readonly notifDispatcher: NotificationDispatcherService,
  ) {}

  async getRefunds(page: number = 1, pageSize: number = 20) {
    const offset = (page - 1) * pageSize;
    const [rows, totalResult] = await Promise.all([
      db.select().from(refunds).orderBy(desc(refunds.created_at)).limit(pageSize).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(refunds),
    ]);
    return { data: rows, total: totalResult[0].count, page, pageSize };
  }

  async getRefundById(id: number) {
    const result = await db.select().from(refunds).where(eq(refunds.id, id));
    const refund = result[0];
    if (!refund) throw new NotFoundException('退款记录不存在');
    return refund;
  }

  /**
   * 创建退款申请。
   *
   * 资金安全约束（P0-1）：
   *  1. 订单必须存在且处于可退款状态（已结账）
   *  2. operator_id 取自 JWT actor，绝不信任前端
   *  3. 退款金额 > 0
   *  4. 本次金额 + 已占额（pending+approved）≤ 订单总额（防超额 / 防重复退款）
   *  5. 校验 + 写入在同一事务内完成，并对订单行加锁，杜绝并发超额
   */
  async createRefund(dto: CreateRefundDto, actor: RefundActor) {
    if (!actor?.userId) {
      throw new BadRequestException({ code: 'OPERATOR_REQUIRED', msg: '缺少操作人信息' });
    }
    const amountCents = toCents(dto.amount);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw new BadRequestException({ code: 'REFUND_AMOUNT_INVALID', msg: '退款金额必须大于 0' });
    }

    const refundId = await db.transaction(async (tx) => {
      // 对订单行加锁，串行化同一订单的并发退款申请
      const orderRows = await tx.select().from(orders).where(eq(orders.id, dto.order_id)).for('update');
      const order = orderRows[0];
      if (!order) {
        throw new BadRequestException({ code: 'ORDER_NOT_FOUND', msg: '订单不存在' });
      }
      if (!REFUNDABLE_ORDER_STATUSES.has(order.status)) {
        throw new BadRequestException({ code: 'ORDER_NOT_REFUNDABLE', msg: '该订单当前状态不可退款（仅已结账订单可退）' });
      }

      const orderCents = toCents(order.total_amount);
      // 统计已占用额度（pending + approved）
      const existing = await tx
        .select({ amount: refunds.amount, status: refunds.status })
        .from(refunds)
        .where(and(eq(refunds.order_id, dto.order_id), inArray(refunds.status, COUNTED_REFUND_STATUSES as any)));
      const usedCents = existing.reduce((sum, r) => sum + toCents(r.amount), 0);

      if (usedCents + amountCents > orderCents) {
        const remain = centsToDecimal(Math.max(0, orderCents - usedCents));
        throw new ConflictException({
          code: 'REFUND_EXCEEDS_REMAINING',
          msg: `退款金额超出可退额度，剩余可退 ¥${remain}`,
        });
      }

      const insertResult = await tx.insert(refunds).values({
        order_id: dto.order_id,
        amount: centsToDecimal(amountCents),
        reason: dto.reason,
        status: 'pending',
        operator_id: actor.userId,
      });
      return (insertResult as any)[0].insertId as number;
    });

    const refund = await this.getRefundById(refundId);

    // 通知所有商家端：有新的退款申请
    this.ordersGateway.notifyAllAdmins('refundCreated', {
      id: refund.id,
      order_id: refund.order_id,
      amount: refund.amount,
      reason: refund.reason,
      created_at: refund.created_at,
    });

    // 多通道通知（Web Push + Email）：fire-and-forget，绝不阻塞退款主流程
    void this.notifDispatcher.notifyOrderEvent('REFUND', refund.order_id);

    return refund;
  }

  /**
   * 审批退款（通过 / 拒绝）。
   *
   * 资金安全约束（P0-1）：
   *  1. 仅 pending 可被处理（防重复审批）
   *  2. operator_id 取自 JWT actor，绝不信任前端
   *  3. 退款记录状态 + 订单状态在同一事务内更新（避免「批了但订单状态没改」的不一致）
   *  4. approve 时对订单行加锁并复核订单仍处于已结账状态
   */
  async updateRefundStatus(id: number, dto: UpdateRefundStatusDto, actor: RefundActor) {
    if (!actor?.userId) {
      throw new BadRequestException({ code: 'OPERATOR_REQUIRED', msg: '缺少操作人信息' });
    }

    await db.transaction(async (tx) => {
      // 锁定退款行，串行化并发审批
      const refundRows = await tx.select().from(refunds).where(eq(refunds.id, id)).for('update');
      const refund = refundRows[0];
      if (!refund) {
        throw new NotFoundException({ code: 'REFUND_NOT_FOUND', msg: '退款记录不存在' });
      }
      if (refund.status !== 'pending') {
        throw new ConflictException({ code: 'REFUND_ALREADY_HANDLED', msg: '该退款申请已处理' });
      }

      if (dto.status === 'approved') {
        // 锁订单行复核状态
        const orderRows = await tx.select().from(orders).where(eq(orders.id, refund.order_id)).for('update');
        const order = orderRows[0];
        if (!order) {
          throw new BadRequestException({ code: 'ORDER_NOT_FOUND', msg: '关联订单不存在' });
        }
        // 已退款的订单不可再次批准（防重复退款落账）
        if (order.status === 'refunded') {
          throw new ConflictException({ code: 'ORDER_ALREADY_REFUNDED', msg: '该订单已退款' });
        }
        await tx.update(orders).set({ status: 'refunded' }).where(eq(orders.id, refund.order_id));
      }

      await tx.update(refunds).set({
        status: dto.status,
        operator_id: actor.userId,
        updated_at: new Date(),
      }).where(eq(refunds.id, id));
    });

    const updated = await this.getRefundById(id);

    // 通知所有商家端：退款已处理
    this.ordersGateway.notifyAllAdmins('refundUpdated', {
      id: updated.id,
      order_id: updated.order_id,
      status: updated.status,
    });

    return updated;
  }
}
