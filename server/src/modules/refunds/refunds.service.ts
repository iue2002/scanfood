import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { refunds, orders } from '@/storage/database/shared/schema';
import { CreateRefundDto, UpdateRefundStatusDto } from './dto/refund.dto';
import { eq, desc, sql } from 'drizzle-orm';
import { OrdersGateway } from '../orders/orders.gateway';
import { NotificationDispatcherService } from '../notif/notification-dispatcher.service';

@Injectable()
export class RefundsService {
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

  async createRefund(dto: CreateRefundDto) {
    const orderResult = await db.select().from(orders).where(eq(orders.id, dto.order_id));
    if (orderResult.length === 0) throw new BadRequestException('订单不存在');

    const insertResult = await db.insert(refunds).values({
      order_id: dto.order_id,
      amount: dto.amount.toFixed(2),
      reason: dto.reason,
      status: 'pending',
      operator_id: 0,
    });
    const newId = (insertResult as any)[0].insertId;
    const refund = await this.getRefundById(newId);

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

  async updateRefundStatus(id: number, dto: UpdateRefundStatusDto) {
    const refund = await this.getRefundById(id);
    if (refund.status !== 'pending') {
      throw new BadRequestException('该退款申请已处理');
    }

    await db.update(refunds).set({
      status: dto.status,
      operator_id: dto.operator_id || 0,
    }).where(eq(refunds.id, id));

    if (dto.status === 'approved') {
      await db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, refund.order_id));
    }

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
