import { Injectable, BadRequestException, NotFoundException, Inject, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { orders, order_items, tables, users, carts, cart_items, dishes } from '@/storage/database/shared/schema';
import { CreateOrderDto, AddOrderItemDto, UpdateOrderStatusDto } from './dto/order.dto';
import { eq, and, inArray, desc, sql, like } from 'drizzle-orm';
import { OrdersGateway } from './orders.gateway';
import { NotificationDispatcherService } from '../notif/notification-dispatcher.service';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { computeBizDate } from './pickup-no.core';
import { OrderLifecycleCore, ORDER_STATUS } from './order-lifecycle.core';
import { IDEMPOTENCY_STORE_TOKEN } from '@/modules/common/adapters/mysql-idempotency-store.adapter';
import { EVENT_OUTBOX_TOKEN } from '@/modules/common/adapters/mysql-event-outbox.adapter';
import type { IdempotencyStorePort } from '@/modules/common/ports/idempotency-store.port';
import type { EventOutboxPort } from '@/modules/common/ports/event-outbox.port';
import * as crypto from 'crypto';

function hashPayload(data: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

/**
 * 金额按「分」做整数运算，规避 decimal 字符串走 parseFloat 浮点累加的误差。
 * （与 refunds/statistics 的整数分/SQL DECIMAL 策略保持一致）
 */
function toCents(amount: string | number | null | undefined): number {
  const n = typeof amount === 'number' ? amount : parseFloat(String(amount ?? 0));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}
function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * 订单访问者上下文（来自 JWT）。
 * 用于顾客端点的归属校验，杜绝改 URL 里 :id 越权读/改他人订单（IDOR）。
 */
export interface OrderActor {
  userId?: number;
  role?: string;
}

/** 员工角色：可管理全部订单，不受归属限制 */
const STAFF_ROLES: ReadonlySet<string> = new Set(['owner', 'manager', 'cashier', 'waiter', 'admin']);

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersGateway: OrdersGateway,
    private readonly notifDispatcher: NotificationDispatcherService,
    private readonly storeSettingsService: StoreSettingsService,
    @Inject(IDEMPOTENCY_STORE_TOKEN)
    private readonly idempotencyStore: IdempotencyStorePort,
    @Inject(EVENT_OUTBOX_TOKEN)
    private readonly outbox: EventOutboxPort,
  ) {}
  private generateOrderNumber(): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = Date.now().toString().slice(-6);
    return `ORD${dateStr}${timeStr}`;
  }

  private async allocatePickupNo(now: Date): Promise<number> {
    const settings = await this.storeSettingsService.getStoreSettings();
    const reset = settings?.pickup_reset_time || '00:00';
    const bizDate = computeBizDate(now, reset);

    return await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO daily_pickup_counters (biz_date, current_no)
        VALUES (${bizDate}, LAST_INSERT_ID(1))
        ON DUPLICATE KEY UPDATE current_no = LAST_INSERT_ID(current_no + 1)
      `);
      const rows = await tx.execute(sql`SELECT LAST_INSERT_ID() AS current_no`);
      const value = (rows as any)[0]?.current_no ?? (rows as any)[0]?.[0]?.current_no;
      if (!value) throw new Error('pickup_no allocate failed');
      return Number(value);
    });
  }

  // 外带订单虚拟桌：所有外带订单共享，永远 idle，前端看板里隐藏
  // 用 table_number='__TAKEAWAY__' 作为唯一标识，避免和真实桌号冲突
  private async getOrCreateTakeawayTable(): Promise<number> {
    const TAKEAWAY_NUMBER = '__TAKEAWAY__';
    const exist = await db.select().from(tables).where(eq(tables.table_number, TAKEAWAY_NUMBER)).limit(1);
    if (exist[0]) return exist[0].id;
    const insertResult = await db.insert(tables).values({
      table_number: TAKEAWAY_NUMBER,
      capacity: 0,
      status: 'idle',
    });
    return (insertResult as any)[0].insertId;
  }

  async getTableCurrentOrder(tableId: number) {
    const activeStatuses = OrderLifecycleCore.activeStatuses();
    const result = await db.select().from(orders)
      .where(and(
        eq(orders.table_id, tableId),
        inArray(orders.status, activeStatuses as any),
      ))
      .orderBy(desc(orders.created_at))
      .limit(1);

    const order = result[0];
    if (!order) return null;

    const items = await db.select().from(order_items).where(eq(order_items.order_id, order.id));
    const tableResult = await db.select().from(tables).where(eq(tables.id, order.table_id));

    return {
      ...order,
      order_items: items,
      tables: tableResult[0] || null,
    };
  }

  async getMyActiveOrder(userId: number) {
    const activeStatuses = OrderLifecycleCore.activeStatuses();
    const result = await db.select().from(orders)
      .where(and(
        eq(orders.user_id, userId),
        inArray(orders.status, activeStatuses as any),
      ))
      .orderBy(desc(orders.created_at))
      .limit(1);

    const order = result[0];
    if (!order) return null;

    const items = await db.select().from(order_items).where(eq(order_items.order_id, order.id));
    const tableResult = await db.select().from(tables).where(eq(tables.id, order.table_id));

    return {
      ...order,
      order_items: items,
      tables: tableResult[0] || null,
    };
  }

  /**
   * 查找桌台当前「占用中」的订单（draft/submitted/printed/unpaid 里最新一笔）。
   * 与 getTableCurrentOrder 的区别：本方法**包含 draft**，供 syncDraft 复用既有草稿。
   */
  private async getTableOccupyingOrder(tableId: number) {
    const occupyingStatuses = OrderLifecycleCore.occupyingStatuses();
    const result = await db.select().from(orders)
      .where(and(
        eq(orders.table_id, tableId),
        inArray(orders.status, occupyingStatuses as any),
      ))
      .orderBy(desc(orders.created_at))
      .limit(1);
    return result[0] ?? null;
  }

  async syncDraft(dto: CreateOrderDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('购物车不能为空');
    }
    if (!dto.table_id) {
      throw new BadRequestException('草稿购物车必须绑定桌号');
    }

    const tableId: number = dto.table_id;
    // 查找该桌台是否已有占用订单（含 draft，修复：原 getTableCurrentOrder 不含 draft
    // 导致「更新已有草稿」分支永远进不去，每次同步都新建一行草稿，草稿表膨胀）
    const activeOrder = await this.getTableOccupyingOrder(tableId);

    if (activeOrder && activeOrder.status !== 'draft') {
      // 如果已有正式订单，则不能再创建或更新草稿；返回完整订单详情（含明细）
      return await this.getOrderById(activeOrder.id);
    }

    let orderId = activeOrder?.id;
    const orderNumber = activeOrder?.order_number || this.generateOrderNumber();

    let totalCents = 0;
    const itemsToInsert = dto.items.map(item => {
      const subtotalCents = toCents(item.price) * item.quantity;
      totalCents += subtotalCents;
      return {
        dish_id: item.dish_id,
        spec_id: item.spec_id,
        dish_name: item.dish_name,
        spec_name: item.spec_name,
        quantity: item.quantity,
        price: item.price.toFixed(2),
        subtotal: centsToDecimal(subtotalCents),
        added_by_user_id: item.added_by_user_id || dto.user_id,
        added_by_nickname: item.added_by_nickname || '未知用户',
        phase: 'order' as const,
        add_more_round: 0,
      };
    });

    // ---- 事务：草稿写入 ----
    await db.transaction(async (tx) => {
      if (orderId && activeOrder) {
        // 更新现有草稿
        await tx.update(orders).set({
          total_amount: centsToDecimal(totalCents),
          user_id: dto.user_id || activeOrder.user_id,
          remark: dto.remark || activeOrder.remark,
          updated_at: new Date(),
        }).where(eq(orders.id, orderId));

        await tx.delete(order_items).where(eq(order_items.order_id, orderId));
        await tx.insert(order_items).values(itemsToInsert.map(item => ({ ...item, order_id: orderId as number })));
      } else {
        // 创建新草稿
        const insertResult = await tx.insert(orders).values({
          table_id: tableId,
          order_number: orderNumber,
          total_amount: centsToDecimal(totalCents),
          user_id: dto.user_id,
          remark: dto.remark,
          status: 'draft',
        });
        const newOrderId = (insertResult as any)[0].insertId;
        orderId = newOrderId;
        await tx.insert(order_items).values(itemsToInsert.map(item => ({ ...item, order_id: newOrderId })));

        // 更新桌台状态
        await tx.update(tables).set({ status: 'occupied' }).where(eq(tables.id, tableId));
      }
    });

    // ---- 事务外：副作用 ----
    const order = await this.getOrderById(orderId as number);
    this.ordersGateway.notifyTableUpdate(tableId, order);
    this.ordersGateway.notifyAllAdmins('orderUpdated', order);
    return order;
  }

  async syncAddMore(orderId: number, dto: { items: Array<{ dish_id: number; spec_id?: number; dish_name: string; spec_name?: string; quantity: number; price: number; added_by_user_id?: number; added_by_nickname?: string }>; idempotency_key?: string }) {
    // P0-4：幂等校验
    if (dto.idempotency_key) {
      const idemResult = await this.idempotencyStore.begin({
        scope: 'order:add-more',
        key: `${orderId}:${dto.idempotency_key}`,
        requestHash: hashPayload({ orderId, items: dto.items }),
      });
      if (idemResult.result === 'replay') return idemResult.cachedResponse ?? { message: '加菜已提交' };
      if (idemResult.result === 'conflict') throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', msg: '请求冲突，请刷新后重试' });
    }

    // 事务前：读取订单并校验状态
    const order = await this.getOrderById(orderId);
    if (!OrderLifecycleCore.canAddMore(order.status)) {
      throw new BadRequestException('订单状态不允许加餐');
    }

    // 获取当前最大的加餐轮次
    const maxRoundResult = await db.select({ maxRound: sql`MAX(${order_items.add_more_round})` })
      .from(order_items)
      .where(eq(order_items.order_id, orderId));
    const currentMaxRound = (maxRoundResult[0]?.maxRound as number) || 0;
    const nextRound = currentMaxRound + 1;

    // 计算新金额（整数分累加，避免浮点误差）
    let totalCents = toCents(order.total_amount || '0');
    const itemsToInsert: any[] = [];
    for (const newItem of dto.items) {
      const subtotalCents = toCents(newItem.price) * newItem.quantity;
      totalCents += subtotalCents;
      itemsToInsert.push({
        order_id: orderId,
        dish_id: newItem.dish_id,
        spec_id: newItem.spec_id,
        dish_name: newItem.dish_name,
        spec_name: newItem.spec_name,
        quantity: newItem.quantity,
        price: newItem.price.toFixed(2),
        subtotal: centsToDecimal(subtotalCents),
        added_by_user_id: newItem.added_by_user_id,
        added_by_nickname: newItem.added_by_nickname || '商家',
        phase: 'add_more' as const,
        add_more_round: nextRound,
      });
    }

    // ---- 事务：加菜写入 + outbox ----
    await db.transaction(async (tx) => {
      await tx.insert(order_items).values(itemsToInsert);
      await tx.update(orders).set({
        total_amount: centsToDecimal(totalCents),
        updated_at: new Date(),
      }).where(eq(orders.id, orderId));

      // P1-1：写入 outbox 事件
      await this.outbox.append(tx, {
        event_type: 'ORDER_ADD_MORE',
        aggregate_type: 'order',
        aggregate_id: String(orderId),
        payload: { orderId, tableId: order.table_id },
      });
    });

    // ---- 事务外：副作用 ----
    void this.markOrderAsPrinted(orderId);

    const updatedOrder = await this.getOrderById(orderId);
    this.ordersGateway.notifyTableUpdate(order.table_id, updatedOrder);
    this.ordersGateway.notifyOrderUpdate(orderId, updatedOrder);
    this.ordersGateway.notifyAllAdmins('orderUpdated', updatedOrder);
    void this.notifDispatcher.notifyOrderEvent('ADD_ITEM', orderId);

    // P0-4：幂等标记成功
    if (dto.idempotency_key) {
      void this.idempotencyStore.complete({ scope: 'order:add-more', key: `${orderId}:${dto.idempotency_key}`, response: updatedOrder });
    }

    return updatedOrder;
  }

  async getOrders(status?: string, tableId?: number, dateFrom?: string, dateTo?: string, tag?: string, page: number = 1, pageSize: number = 20, skipDraft = false, search?: string) {
    const conditions: any[] = [];
    if (skipDraft) {
      conditions.push(sql`${orders.status} != 'draft'`);
    }
    if (status) conditions.push(eq(orders.status, status));
    if (tableId) conditions.push(eq(orders.table_id, tableId));
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      conditions.push(sql`${orders.created_at} >= ${fromDate}`);
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      conditions.push(sql`${orders.created_at} <= ${toDate}`);
    }
    // 订单号模糊搜索：去除空白 + 防止 SQL 通配符注入（% _ \）
    if (search && search.trim().length > 0) {
      const escaped = search.trim().replace(/[\\%_]/g, (m) => '\\' + m);
      conditions.push(like(orders.order_number, `%${escaped}%`));
    }

    const offset = (page - 1) * pageSize;

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // 并行：当前页数据 + 总数（修复：原先不返回 total，前端无法算总页数）
    const [orderList, totalRows] = await Promise.all([
      whereClause
        ? db.select().from(orders).where(whereClause).orderBy(desc(orders.created_at)).offset(offset).limit(pageSize)
        : db.select().from(orders).orderBy(desc(orders.created_at)).offset(offset).limit(pageSize),
      whereClause
        ? db.select({ count: sql<number>`count(*)` }).from(orders).where(whereClause)
        : db.select({ count: sql<number>`count(*)` }).from(orders),
    ]);
    const total = Number(totalRows[0]?.count ?? 0);

    // 获取当前页订单关联的table_id和user_id
    const tableIds = [...new Set(orderList.map(o => o.table_id).filter(Boolean))] as number[];
    const userIds = [...new Set(orderList.map(o => o.user_id).filter(Boolean))] as number[];

    // 只查询当前页订单需要的表和用户
    let tableList: any[] = [];
    let userList: any[] = [];
    if (tableIds.length > 0) {
      tableList = await db.select().from(tables).where(inArray(tables.id, tableIds as any));
    }
    if (userIds.length > 0) {
      userList = await db.select().from(users).where(inArray(users.id, userIds as any));
    }

    // 获取当前页订单的items
    const orderIds = orderList.map(o => o.id);
    let itemsList: any[] = [];
    if (orderIds.length > 0) {
      itemsList = await db.select().from(order_items).where(inArray(order_items.order_id, orderIds as any));
    }

    const data = orderList.map(o => ({
      ...o,
      tables: tableList.find(t => t.id === o.table_id) || null,
      users: userList.find(u => u.id === o.user_id) || null,
      order_items: itemsList.filter(item => item.order_id === o.id),
    }));

    return { data, total, page, pageSize };
  }

  async getOrderById(id: number) {
    const result = await db.select().from(orders).where(eq(orders.id, id));
    const order = result[0];
    if (!order) throw new NotFoundException('订单不存在');

    const items = await db.select().from(order_items).where(eq(order_items.order_id, id));
    const tableResult = await db.select().from(tables).where(eq(tables.id, order.table_id));
    const userResult = order.user_id ? await db.select().from(users).where(eq(users.id, order.user_id)) : [];

    return {
      ...order,
      order_items: items,
      tables: tableResult[0] || null,
      users: userResult[0] || null,
    };
  }

  /**
   * 顾客端点的订单归属校验（P0-2：堵 IDOR 越权）。
   *
   * 共享点单场景下「同桌协作」是既有红线，所以归属边界放到桌台级，而非仅创建者：
   *  - 员工角色（owner/manager/cashier/waiter/admin）：放行，可管理全部订单
   *  - 顾客（customer）：放行当且仅当
   *      a) 订单是自己创建的（order.user_id === actor.userId），或
   *      b) 订单所在桌台 === 该顾客当前绑定的桌台（同桌的其他人也能查看/协作）
   *  - actor 缺失（理论上 JwtAuthGuard 已拦截）：拒绝
   *
   * 不传 actor 时跳过校验（兼容内部调用 / 不暴露给顾客的路径）。
   */
  private async assertOrderAccess(order: { id: number; user_id: number | null; table_id: number }, actor?: OrderActor): Promise<void> {
    if (!actor) return; // 内部调用，无需校验
    if (actor.role && STAFF_ROLES.has(actor.role)) return; // 员工放行
    if (!actor.userId) {
      throw new ForbiddenException({ code: 'ORDER_FORBIDDEN', msg: '无权访问该订单' });
    }
    // a) 自己创建的订单
    if (order.user_id != null && order.user_id === actor.userId) return;
    // b) 同桌协作：订单桌台 === 顾客当前绑定桌台
    const me = await db
      .select({ table_number: users.table_number })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1);
    const myTableNumber = me[0]?.table_number;
    if (myTableNumber) {
      const orderTable = await db
        .select({ table_number: tables.table_number })
        .from(tables)
        .where(eq(tables.id, order.table_id))
        .limit(1);
      if (orderTable[0]?.table_number && orderTable[0].table_number === myTableNumber) return;
    }
    throw new ForbiddenException({ code: 'ORDER_FORBIDDEN', msg: '无权访问该订单' });
  }

  /** 顾客端读取订单详情（带归属校验，防 IDOR） */
  async getOrderByIdForActor(id: number, actor?: OrderActor) {
    const order = await this.getOrderById(id);
    await this.assertOrderAccess(order, actor);
    return order;
  }

  async createOrder(dto: CreateOrderDto) {
    // P0-4：幂等校验
    if (dto.idempotency_key) {
      const idemResult = await this.idempotencyStore.begin({
        scope: 'order:create',
        key: dto.idempotency_key,
        requestHash: hashPayload({ items: dto.items, table_id: dto.table_id, order_type: dto.order_type }),
        actorId: dto.user_id,
      });
      if (idemResult.result === 'replay') {
        return idemResult.cachedResponse ?? { message: '订单已提交，请查看订单详情' };
      }
      if (idemResult.result === 'conflict') {
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', msg: '请求冲突，请刷新后重试' });
      }
    }

    // 必选 / 最少数量校验（仅订单首次提交时校验，加菜不受限）
    await this.assertRequiredAndMinQuantity(dto.items);

    let totalCents = 0;
    const orderItemsData = dto.items.map(item => {
      const subtotalCents = toCents(item.price) * item.quantity;
      totalCents += subtotalCents;
      return {
        ...item,
        subtotalCents,
      };
    });

    const orderNumber = this.generateOrderNumber();
    const isTakeaway = dto.order_type === 'takeaway';
    const now = new Date();
    // allocatePickupNo 自身有独立事务，放在外层
    const pickupNo = isTakeaway ? await this.allocatePickupNo(now) : null;

    // 外带：自动指向虚拟"打包"桌，避免外键约束失败
    let tableId: number | undefined = dto.table_id;
    if (isTakeaway) {
      tableId = await this.getOrCreateTakeawayTable();
    }
    if (!tableId) {
      throw new BadRequestException('堂食订单缺少 table_id');
    }
    const finalTableId: number = tableId;

    // ---- 幂等包装：事务 + 副作用 ----
    const idemKey = dto.idempotency_key;
    try {
    // ---- 事务：订单 + 明细 + 桌台 + 清购物车 ----
    const orderId = await db.transaction(async (tx) => {
      const insertResult = await tx.insert(orders).values({
        table_id: finalTableId,
        order_number: orderNumber,
        total_amount: centsToDecimal(totalCents),
        user_id: dto.user_id,
        remark: dto.remark,
        status: 'submitted',
        order_type: isTakeaway ? 'takeaway' : 'dine_in',
        pickup_no: pickupNo,
      });

      const newOrderId = (insertResult as any)[0].insertId;

      const itemsToInsert = orderItemsData.map(item => ({
        order_id: newOrderId,
        dish_id: item.dish_id,
        spec_id: item.spec_id,
        dish_name: item.dish_name,
        spec_name: item.spec_name,
        quantity: item.quantity,
        price: item.price.toFixed(2),
        subtotal: centsToDecimal(item.subtotalCents),
        added_by_user_id: item.added_by_user_id || dto.user_id,
        added_by_nickname: item.added_by_nickname || '未知用户',
      }));

      await tx.insert(order_items).values(itemsToInsert);

      // 外带不占桌；堂食才把桌台标记为 occupied + 清购物车
      if (!isTakeaway) {
        await tx.update(tables).set({ status: 'occupied' }).where(eq(tables.id, finalTableId));
        // 清空该桌台购物车
        const cartList = await tx.select().from(carts).where(eq(carts.table_id, finalTableId));
        if (cartList.length > 0) {
          const cartIds = cartList.map(cart => cart.id);
          await tx.delete(cart_items).where(inArray(cart_items.cart_id, cartIds as any));
          await tx.delete(carts).where(eq(carts.table_id, finalTableId));
        }
      }

      // P1-1：写入 outbox 事件（与订单数据同事务）
      await this.outbox.append(tx, {
        event_type: 'ORDER_CREATED',
        aggregate_type: 'order',
        aggregate_id: String(newOrderId),
        payload: { orderId: newOrderId, tableId: finalTableId },
      });

      return newOrderId;
    });

    // ---- 事务外：副作用（不阻塞主流程） ----
    void this.markOrderAsPrinted(orderId);

    const order = await this.getOrderById(orderId);
    this.ordersGateway.notifyOrderStatusChange(finalTableId, order);
    this.ordersGateway.notifyAllAdmins('orderStatusChanged', order);
    // 多通道通知（Web Push + Email）：fire-and-forget
    void this.notifDispatcher.notifyOrderEvent('NEW_ORDER', orderId);
    // 外带不依赖桌台共享购物车，跳过 cart 推送
    if (!isTakeaway) {
      this.ordersGateway.notifyTableCartUpdate(finalTableId, null);
    }

    // P0-4：幂等标记成功
    if (idemKey) {
      void this.idempotencyStore.complete({ scope: 'order:create', key: idemKey, response: order });
    }

    return order;
    } catch (err) {
      // P0-4：幂等标记失败（可重试）
      if (idemKey) {
        void this.idempotencyStore.fail({ scope: 'order:create', key: idemKey, reason: (err as Error).message });
      }
      throw err;
    }
  }

  async addOrderItem(orderId: number, dto: AddOrderItemDto, actor?: OrderActor) {
    const order = await this.getOrderById(orderId);
    await this.assertOrderAccess(order, actor);
    if (!OrderLifecycleCore.canModifyItems(order.status)) {
      throw new BadRequestException('订单状态不允许添加菜品');
    }

    const subtotalCents = toCents(dto.price) * dto.quantity;

    // ---- 事务：插入明细 + 更新金额 ----
    await db.transaction(async (tx) => {
      await tx.insert(order_items).values({
        order_id: orderId,
        dish_id: dto.dish_id,
        spec_id: dto.spec_id,
        dish_name: dto.dish_name,
        spec_name: dto.spec_name,
        quantity: dto.quantity,
        price: dto.price.toFixed(2),
        subtotal: centsToDecimal(subtotalCents),
        phase: 'add_more',
      });

      const newTotalCents = toCents(order.total_amount as any) + subtotalCents;
      await tx.update(orders).set({ total_amount: centsToDecimal(newTotalCents) }).where(eq(orders.id, orderId));
    });

    // ---- 事务外：副作用 ----
    void this.markOrderAsPrinted(orderId);

    const updatedOrder = await this.getOrderById(orderId);
    this.ordersGateway.notifyTableUpdate(order.table_id, updatedOrder);
    this.ordersGateway.notifyAllAdmins('orderUpdated', updatedOrder);
    void this.notifDispatcher.notifyOrderEvent('ADD_ITEM', orderId);
    return updatedOrder;
  }

  async removeOrderItem(orderId: number, itemId: number, quantity?: number, actor?: OrderActor) {
    const order = await this.getOrderById(orderId);
    await this.assertOrderAccess(order, actor);
    if (!OrderLifecycleCore.canModifyItems(order.status)) {
      throw new BadRequestException('订单状态不允许修改');
    }

    const item = order.order_items.find((i: any) => i.id === itemId);
    if (!item) throw new NotFoundException('订单明细不存在');

    // ---- 事务：删除/更新明细 + 更新金额 ----
    await db.transaction(async (tx) => {
      if (quantity && quantity < item.quantity) {
        const newQuantity = item.quantity - quantity;
        const priceCents = toCents(item.price);
        const newSubtotalCents = priceCents * newQuantity;
        await tx.update(order_items).set({
          quantity: newQuantity,
          subtotal: centsToDecimal(newSubtotalCents),
        }).where(eq(order_items.id, itemId));

        const diffCents = priceCents * quantity;
        const newTotalCents = toCents(order.total_amount as any) - diffCents;
        await tx.update(orders).set({ total_amount: centsToDecimal(newTotalCents) }).where(eq(orders.id, orderId));
      } else {
        await tx.delete(order_items).where(eq(order_items.id, itemId));
        const newTotalCents = toCents(order.total_amount as any) - toCents(item.subtotal);
        await tx.update(orders).set({ total_amount: centsToDecimal(newTotalCents) }).where(eq(orders.id, orderId));
      }
    });

    // ---- 事务外：副作用 ----
    const updatedOrder = await this.getOrderById(orderId);
    this.ordersGateway.notifyTableUpdate(order.table_id, updatedOrder);
    this.ordersGateway.notifyAllAdmins('orderUpdated', updatedOrder);
    return updatedOrder;
  }

  async updateOrderItemQuantity(orderId: number, itemId: number, quantity: number, actor?: OrderActor) {
    const order = await this.getOrderById(orderId);
    await this.assertOrderAccess(order, actor);
    if (!OrderLifecycleCore.canAddMore(order.status)) {
      throw new BadRequestException('订单状态不允许修改');
    }

    const item = order.order_items.find((i: any) => i.id === itemId);
    if (!item) throw new NotFoundException('订单明细不存在');

    // ---- 事务：更新明细 + 更新金额 ----
    await db.transaction(async (tx) => {
      if (quantity <= 0) {
        await tx.delete(order_items).where(eq(order_items.id, itemId));
      } else {
        const newSubtotalCents = toCents(item.price) * quantity;
        await tx.update(order_items).set({
          quantity,
          subtotal: centsToDecimal(newSubtotalCents),
        }).where(eq(order_items.id, itemId));
      }

      const oldSubtotalCents = toCents(item.subtotal);
      const newSubtotalCents = quantity <= 0 ? 0 : toCents(item.price) * quantity;
      const newTotalCents = toCents(order.total_amount as any) - oldSubtotalCents + newSubtotalCents;
      await tx.update(orders).set({ total_amount: centsToDecimal(newTotalCents) }).where(eq(orders.id, orderId));
    });

    // ---- 事务外：副作用 ----
    const updatedOrder = await this.getOrderById(orderId);
    this.ordersGateway.notifyTableUpdate(order.table_id, updatedOrder);
    this.ordersGateway.notifyAllAdmins('orderUpdated', updatedOrder);
    return updatedOrder;
  }

  async updateOrderItemServed(orderId: number, itemId: number, served: boolean) {
    const order = await this.getOrderById(orderId);
    if (!OrderLifecycleCore.canMarkServed(order.status)) {
      throw new BadRequestException('订单状态不允许修改上菜状态');
    }

    const item = order.order_items.find((currentItem: any) => currentItem.id === itemId);
    if (!item) throw new NotFoundException('订单明细不存在');

    await db
      .update(order_items)
      .set({
        served_at: served ? new Date() : null,
      })
      .where(and(eq(order_items.id, itemId), eq(order_items.order_id, orderId)));

    const updatedOrder = await this.getOrderById(orderId);
    this.ordersGateway.notifyTableUpdate(order.table_id, updatedOrder);
    this.ordersGateway.notifyOrderUpdate(orderId, updatedOrder);
    this.ordersGateway.notifyOrderItemServedChanged(order.table_id, updatedOrder, { itemId, served });
    return updatedOrder;
  }

  async updateOrderStatus(orderId: number, dto: UpdateOrderStatusDto) {
    // P0-4：幂等校验
    if (dto.idempotency_key) {
      const idemResult = await this.idempotencyStore.begin({
        scope: 'order:status',
        key: `${orderId}:${dto.idempotency_key}`,
        requestHash: hashPayload({ orderId, status: dto.status }),
      });
      if (idemResult.result === 'replay') return idemResult.cachedResponse ?? { message: '状态已更新' };
      if (idemResult.result === 'conflict') throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', msg: '请求冲突，请刷新后重试' });
    }

    const order = await this.getOrderById(orderId);

    // P0-3：状态流转合法性校验（防止把已结账/已取消订单改回任意状态，或非法跳转）
    if (!OrderLifecycleCore.canTransition(order.status, dto.status)) {
      throw new ConflictException({
        code: 'ORDER_STATUS_TRANSITION_INVALID',
        msg: `订单当前状态（${order.status}）不允许变更为「${dto.status}」`,
      });
    }

    // ---- 事务：订单状态 + 桌台状态 + outbox ----
    await db.transaction(async (tx) => {
      if (dto.status === 'settled') {
        await tx.update(tables).set({ status: 'idle' }).where(eq(tables.id, order.table_id));
      }
      await tx.update(orders).set({
        status: dto.status,
        ...(dto.status === 'settled' ? { settled_at: new Date() } : {}),
      }).where(eq(orders.id, orderId));

      // P1-1：结账时写入 outbox 事件
      if (dto.status === 'settled') {
        await this.outbox.append(tx, {
          event_type: 'ORDER_SETTLED',
          aggregate_type: 'order',
          aggregate_id: String(orderId),
          payload: { orderId, tableId: order.table_id },
        });
      }
    });

    // ---- 事务外：副作用 ----
    const updatedOrder = await this.getOrderById(orderId);
    this.ordersGateway.notifyOrderStatusChange(order.table_id, updatedOrder);
    this.ordersGateway.notifyAllAdmins('orderStatusChanged', updatedOrder);

    // P0-4：幂等标记成功
    if (dto.idempotency_key) {
      void this.idempotencyStore.complete({ scope: 'order:status', key: `${orderId}:${dto.idempotency_key}`, response: updatedOrder });
    }

    return updatedOrder;
  }

  /**
   * 标记订单为"已打印"
   *
   * 历史背景：早期是 fake 打印 stub（console.log + print_records 假成功），
   * 真打印由 mop print 模块负责。这个方法现在只承担状态机职责：
   *   - submitted → printed
   *   - 设置 printed_at
   *
   * 调用时机：createOrder / 加菜（addOrderItem / syncAddMore）
   * 真打印链路：mop PrintEventHook 监听 OrdersGateway.notifyAllAdmins 事件，
   *            自动触发 PrintCore.onOrderEvent (NEW_ORDER / ADD_MORE)
   */
  private async markOrderAsPrinted(orderId: number): Promise<void> {
    try {
      // P0-3：仅当订单仍处于 submitted 时才翻成 printed（用状态机推导下一态）。
      // 关键：带 WHERE status='submitted' 条件更新，保证这条 fire-and-forget 调用
      // 不会覆盖并发发生的结账/取消（那些操作已把 status 改走，本更新命中 0 行）。
      const nextStatus = OrderLifecycleCore.nextStatusOnPrint(ORDER_STATUS.SUBMITTED);
      await db.update(orders).set({
        status: nextStatus,
        printed_at: new Date(),
      }).where(and(eq(orders.id, orderId), eq(orders.status, ORDER_STATUS.SUBMITTED)));
    } catch (err) {
      // 状态标记失败不影响主流程；mop 真打印走独立路径不依赖此状态
      const logger = new Logger(OrdersService.name);
      logger.error(`[orders] markOrderAsPrinted failed: ${(err as Error).message}`);
    }
  }

  /**
   * 提交订单时的必选 / 最少数量校验
   *
   * 规则：
   *   - 商家把某菜标记 is_required=true：顾客下单必须包含此菜（status=available 才计入必选）
   *   - 选了某菜则数量必须 ≥ min_quantity
   *
   * 不变量：
   *   - 仅 createOrder 时校验，加菜（addOrderItem / syncAddMore）不受限
   *   - 下架（status=unavailable）的菜即使标记必选也不强制（避免商家忘下架某必选菜导致全店无法下单）
   *
   * 失败时抛 BadRequestException，前端据 code 给具体引导文案：
   *   - REQUIRED_DISH_MISSING：必选菜未点
   *   - MIN_QUANTITY_NOT_MET：选了某菜但数量低于 min_quantity
   */
  private async assertRequiredAndMinQuantity(
    items: Array<{ dish_id: number; quantity: number }>,
  ): Promise<void> {
    if (!items || items.length === 0) {
      throw new BadRequestException({ code: 'EMPTY_CART', message: '购物车不能为空' });
    }

    // 1) 拿订单中所有涉及的 dish 信息（去重）
    const orderDishIds = Array.from(new Set(items.map((it) => it.dish_id).filter((id) => id != null)));
    const orderDishes = orderDishIds.length > 0
      ? await db.select({
          id: dishes.id,
          name: dishes.name,
          status: dishes.status,
          is_required: dishes.is_required,
          min_quantity: dishes.min_quantity,
        }).from(dishes).where(inArray(dishes.id, orderDishIds))
      : [];

    // 2) 校验：每个被选菜品的数量 ≥ min_quantity
    const dishMap = new Map(orderDishes.map((d) => [d.id, d]));
    // 把同一 dish_id 多份合并（不同规格也算同一菜）
    const qtyByDishId = new Map<number, number>();
    for (const it of items) {
      qtyByDishId.set(it.dish_id, (qtyByDishId.get(it.dish_id) ?? 0) + (it.quantity || 0));
    }
    const minQtyViolations: Array<{ name: string; required: number; actual: number }> = [];
    for (const [dishId, qty] of qtyByDishId) {
      const d = dishMap.get(dishId);
      if (!d) continue;
      if (d.min_quantity > 1 && qty < d.min_quantity) {
        minQtyViolations.push({ name: d.name, required: d.min_quantity, actual: qty });
      }
    }
    if (minQtyViolations.length > 0) {
      const detail = minQtyViolations
        .map((v) => `${v.name}（至少 ${v.required} 份，当前 ${v.actual} 份）`)
        .join('、');
      throw new BadRequestException({
        code: 'MIN_QUANTITY_NOT_MET',
        message: `以下菜品未达到最少数量：${detail}`,
        violations: minQtyViolations,
      });
    }

    // 3) 校验：必选菜品（is_required + status=available）必须都被点
    const requiredDishes = await db.select({
      id: dishes.id,
      name: dishes.name,
      min_quantity: dishes.min_quantity,
    }).from(dishes).where(and(
      eq(dishes.is_required, true),
      eq(dishes.status, 'available'),
    ));

    const orderDishIdSet = new Set(orderDishIds);
    const missing = requiredDishes.filter((d) => !orderDishIdSet.has(d.id));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'REQUIRED_DISH_MISSING',
        message: `请先点必选菜品：${missing.map((m) => m.name).join('、')}`,
        missing: missing.map((m) => ({ id: m.id, name: m.name, min_quantity: m.min_quantity })),
      });
    }
  }

  async deleteOrder(orderId: number) {
    const order = await this.getOrderById(orderId);
    if (!OrderLifecycleCore.canDelete(order.status)) {
      throw new BadRequestException('只能删除草稿状态的订单');
    }

    // ---- 事务：删除订单 + 明细 + 释放桌台 ----
    await db.transaction(async (tx) => {
      await tx.delete(order_items).where(eq(order_items.order_id, orderId));
      await tx.delete(orders).where(eq(orders.id, orderId));

      // 如果该桌台没有其他占用桌台的订单，恢复为 idle
      const tableResult = await tx.select().from(tables).where(eq(tables.id, order.table_id));
      // 用状态机统一的占用状态集（含 unpaid），避免硬编码遗漏
      const occupyingStatuses = OrderLifecycleCore.occupyingStatuses();
      // 注意：deleteOrder 之后 orders 已删，查的是其他订单
      const activeOrders = await tx.select().from(orders)
        .where(and(
          eq(orders.table_id, order.table_id),
          inArray(orders.status, occupyingStatuses as any),
        ));
      if (activeOrders.length === 0 && tableResult.length > 0) {
        await tx.update(tables).set({ status: 'idle' }).where(eq(tables.id, order.table_id));
      }
    });

    // ---- 事务外：副作用 ----
    this.ordersGateway.notifyTableUpdate(order.table_id, null);
    this.ordersGateway.notifyAllAdmins('orderDeleted', { id: orderId, table_id: order.table_id });
    return { success: true };
  }

  private async clearTableCart(tableId: number) {
    const cartList = await db.select().from(carts).where(eq(carts.table_id, tableId));
    if (cartList.length === 0) return;

    const cartIds = cartList.map(cart => cart.id);
    await db.delete(cart_items).where(inArray(cart_items.cart_id, cartIds as any));
    await db.delete(carts).where(eq(carts.table_id, tableId));
  }
}
