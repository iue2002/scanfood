import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { orders, order_items, tables, users, carts, cart_items } from '@/storage/database/shared/schema';
import { CreateOrderDto, AddOrderItemDto, UpdateOrderStatusDto } from './dto/order.dto';
import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { OrdersGateway } from './orders.gateway';

@Injectable()
export class OrdersService {
  constructor(private readonly ordersGateway: OrdersGateway) {}
  private generateOrderNumber(): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = Date.now().toString().slice(-6);
    return `ORD${dateStr}${timeStr}`;
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
    const result = await db.select().from(orders)
      .where(and(
        eq(orders.table_id, tableId),
        inArray(orders.status, ['submitted', 'printed', 'unpaid'])
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
    const result = await db.select().from(orders)
      .where(and(
        eq(orders.user_id, userId),
        inArray(orders.status, ['submitted', 'printed', 'unpaid'])
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

  async syncDraft(dto: CreateOrderDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('购物车不能为空');
    }
    if (!dto.table_id) {
      throw new BadRequestException('草稿购物车必须绑定桌号');
    }

    const tableId: number = dto.table_id;
    // 查找该桌台是否已有活跃订单（draft, submitted, printed）
    const activeOrder = await this.getTableCurrentOrder(tableId);

    if (activeOrder && activeOrder.status !== 'draft') {
      // 如果已有正式订单，则不能再创建或更新草稿，除非业务逻辑允许加餐
      // 这里暂定如果已有正式订单，syncDraft 逻辑可能需要调整为加餐逻辑，或者提示错误
      // 为了简化，如果是 submitted/printed，我们直接返回该订单，让前端处理
      return activeOrder;
    }

    let orderId = activeOrder?.id;
    const orderNumber = activeOrder?.order_number || this.generateOrderNumber();

    let totalAmount = 0;
    const itemsToInsert = dto.items.map(item => {
      const subtotal = item.price * item.quantity;
      totalAmount += subtotal;
      return {
        dish_id: item.dish_id,
        spec_id: item.spec_id,
        dish_name: item.dish_name,
        spec_name: item.spec_name,
        quantity: item.quantity,
        price: item.price.toFixed(2),
        subtotal: subtotal.toFixed(2),
        added_by_user_id: item.added_by_user_id || dto.user_id,
        added_by_nickname: item.added_by_nickname || '未知用户',
        phase: 'order' as const,
        add_more_round: 0,
      };
    });

    if (orderId && activeOrder) {
      // 更新现有草稿
      await db.update(orders).set({
        total_amount: totalAmount.toFixed(2),
        user_id: dto.user_id || activeOrder.user_id,
        remark: dto.remark || activeOrder.remark,
        updated_at: new Date(),
      }).where(eq(orders.id, orderId));

      // 简单处理：删除旧明细，插入新明细
      await db.delete(order_items).where(eq(order_items.order_id, orderId));
      await db.insert(order_items).values(itemsToInsert.map(item => ({ ...item, order_id: orderId as number })));
    } else {
      // 创建新草稿
      const insertResult = await db.insert(orders).values({
        table_id: tableId,
        order_number: orderNumber,
        total_amount: totalAmount.toFixed(2),
        user_id: dto.user_id,
        remark: dto.remark,
        status: 'draft',
      });
      const newOrderId = (insertResult as any)[0].insertId;
      orderId = newOrderId;
      await db.insert(order_items).values(itemsToInsert.map(item => ({ ...item, order_id: newOrderId })));
      
      // 更新桌台状态
      await db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, tableId));
    }

    const order = await this.getOrderById(orderId as number);
    this.ordersGateway.notifyTableUpdate(tableId, order);
    this.ordersGateway.notifyAllAdmins('orderUpdated', order);
    return order;
  }

  async syncAddMore(orderId: number, dto: { items: Array<{ dish_id: number; spec_id?: number; dish_name: string; spec_name?: string; quantity: number; price: number; added_by_user_id?: number; added_by_nickname?: string }> }) {
    const order = await this.getOrderById(orderId);
    if (!['submitted', 'printed', 'unpaid'].includes(order.status)) {
      throw new BadRequestException('订单状态不允许加餐');
    }

    // 获取当前最大的加餐轮次
    const maxRoundResult = await db.select({ maxRound: sql`MAX(${order_items.add_more_round})` })
      .from(order_items)
      .where(eq(order_items.order_id, orderId));
    const currentMaxRound = (maxRoundResult[0]?.maxRound as number) || 0;
    const nextRound = currentMaxRound + 1;

    // 计算现有订单金额
    let totalAmount = parseFloat(order.total_amount || '0');

    // 新增菜品直接追加，不删除原有菜品（保留原有时间戳）
    const itemsToInsert: any[] = [];
    for (const newItem of dto.items) {
      const subtotal = newItem.price * newItem.quantity;
      totalAmount += subtotal;
      itemsToInsert.push({
        order_id: orderId,
        dish_id: newItem.dish_id,
        spec_id: newItem.spec_id,
        dish_name: newItem.dish_name,
        spec_name: newItem.spec_name,
        quantity: newItem.quantity,
        price: newItem.price.toFixed(2),
        subtotal: subtotal.toFixed(2),
        added_by_user_id: newItem.added_by_user_id,
        added_by_nickname: newItem.added_by_nickname || '商家', // 默认商家
        phase: 'add_more', // 标记为加餐
        add_more_round: nextRound,
      });
    }

    // 直接插入新菜品，不删除原有菜品
    await db.insert(order_items).values(itemsToInsert);
    await db.update(orders).set({
      total_amount: totalAmount.toFixed(2),
      updated_at: new Date(),
    }).where(eq(orders.id, orderId));

    void this.markOrderAsPrinted(orderId);

    const updatedOrder = await this.getOrderById(orderId);
    // 通知桌台订阅者
    this.ordersGateway.notifyTableUpdate(order.table_id, updatedOrder);
    // 通知订单订阅者（小程序端）
    this.ordersGateway.notifyOrderUpdate(orderId, updatedOrder);
    // 通知所有管理员
    this.ordersGateway.notifyAllAdmins('orderUpdated', updatedOrder);
    return updatedOrder;
  }

  async getOrders(status?: string, tableId?: number, dateFrom?: string, dateTo?: string, tag?: string, page: number = 1, pageSize: number = 20, skipDraft = false) {
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

    const offset = (page - 1) * pageSize;

    let orderList;

    if (conditions.length > 0) {
      orderList = await db.select().from(orders).where(and(...conditions)).orderBy(desc(orders.created_at)).offset(offset).limit(pageSize);
    } else {
      orderList = await db.select().from(orders).orderBy(desc(orders.created_at)).offset(offset).limit(pageSize);
    }

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

    return data;
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

  async createOrder(dto: CreateOrderDto) {
    let totalAmount = 0;
    const orderItemsData = dto.items.map(item => {
      const subtotal = item.price * item.quantity;
      totalAmount += subtotal;
      return {
        ...item,
        subtotal,
      };
    });

    const orderNumber = this.generateOrderNumber();
    const isTakeaway = dto.order_type === 'takeaway';

    // 外带：自动指向虚拟"打包"桌，避免外键约束失败
    let tableId: number | undefined = dto.table_id;
    if (isTakeaway) {
      tableId = await this.getOrCreateTakeawayTable();
    }
    if (!tableId) {
      throw new BadRequestException('堂食订单缺少 table_id');
    }
    const finalTableId: number = tableId;

    const insertResult = await db.insert(orders).values({
      table_id: finalTableId,
      order_number: orderNumber,
      total_amount: totalAmount.toFixed(2),
      user_id: dto.user_id,
      remark: dto.remark,
      status: 'submitted',
      order_type: isTakeaway ? 'takeaway' : 'dine_in',
    });

    const orderId = (insertResult as any)[0].insertId;

    const itemsToInsert = orderItemsData.map(item => ({
      order_id: orderId,
      dish_id: item.dish_id,
      spec_id: item.spec_id,
      dish_name: item.dish_name,
      spec_name: item.spec_name,
      quantity: item.quantity,
      price: item.price.toFixed(2),
      subtotal: item.subtotal.toFixed(2),
      added_by_user_id: item.added_by_user_id || dto.user_id,
      added_by_nickname: item.added_by_nickname || '未知用户',
    }));

    await db.insert(order_items).values(itemsToInsert);
    // 外带不占桌；堂食才把桌台标记为 occupied
    if (!isTakeaway) {
      await db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, finalTableId));
    }

    void this.markOrderAsPrinted(orderId);

    const order = await this.getOrderById(orderId);
    this.ordersGateway.notifyOrderStatusChange(finalTableId, order);
    this.ordersGateway.notifyAllAdmins('orderStatusChanged', order);
    // 外带不依赖桌台共享购物车，跳过 cart 清理 / 推送
    if (!isTakeaway) {
      await this.clearTableCart(finalTableId);
      this.ordersGateway.notifyTableCartUpdate(finalTableId, null);
    }
    return order;
  }

  async addOrderItem(orderId: number, dto: AddOrderItemDto) {
    const order = await this.getOrderById(orderId);
    if (!['submitted', 'printed'].includes(order.status)) {
      throw new BadRequestException('订单状态不允许添加菜品');
    }

    const subtotal = dto.price * dto.quantity;
    await db.insert(order_items).values({
      order_id: orderId,
      dish_id: dto.dish_id,
      spec_id: dto.spec_id,
      dish_name: dto.dish_name,
      spec_name: dto.spec_name,
      quantity: dto.quantity,
      price: dto.price.toFixed(2),
      subtotal: subtotal.toFixed(2),
      phase: 'add_more',
    });

    const newTotal = parseFloat(order.total_amount as any) + subtotal;
    await db.update(orders).set({ total_amount: newTotal.toFixed(2) }).where(eq(orders.id, orderId));

    void this.markOrderAsPrinted(orderId);

    const updatedOrder = await this.getOrderById(orderId);
    this.ordersGateway.notifyTableUpdate(order.table_id, updatedOrder);
    this.ordersGateway.notifyAllAdmins('orderUpdated', updatedOrder);
    return updatedOrder;
  }

  async removeOrderItem(orderId: number, itemId: number, quantity?: number) {
    const order = await this.getOrderById(orderId);
    if (!['submitted', 'printed'].includes(order.status)) {
      throw new BadRequestException('订单状态不允许修改');
    }

    const item = order.order_items.find((i: any) => i.id === itemId);
    if (!item) throw new NotFoundException('订单明细不存在');

    if (quantity && quantity < item.quantity) {
      const newQuantity = item.quantity - quantity;
      const newSubtotal = parseFloat(item.price) * newQuantity;
      await db.update(order_items).set({
        quantity: newQuantity,
        subtotal: newSubtotal.toFixed(2),
      }).where(eq(order_items.id, itemId));

      const diff = parseFloat(item.price) * quantity;
      const newTotal = parseFloat(order.total_amount as any) - diff;
      await db.update(orders).set({ total_amount: newTotal.toFixed(2) }).where(eq(orders.id, orderId));
    } else {
      await db.delete(order_items).where(eq(order_items.id, itemId));
      const newTotal = parseFloat(order.total_amount as any) - parseFloat(item.subtotal);
      await db.update(orders).set({ total_amount: newTotal.toFixed(2) }).where(eq(orders.id, orderId));
    }

    const updatedOrder = await this.getOrderById(orderId);
    this.ordersGateway.notifyTableUpdate(order.table_id, updatedOrder);
    this.ordersGateway.notifyAllAdmins('orderUpdated', updatedOrder);
    return updatedOrder;
  }

  async updateOrderItemQuantity(orderId: number, itemId: number, quantity: number) {
    const order = await this.getOrderById(orderId);
    if (!['submitted', 'printed', 'unpaid'].includes(order.status)) {
      throw new BadRequestException('订单状态不允许修改');
    }

    const item = order.order_items.find((i: any) => i.id === itemId);
    if (!item) throw new NotFoundException('订单明细不存在');

    if (quantity <= 0) {
      await db.delete(order_items).where(eq(order_items.id, itemId));
    } else {
      const newSubtotal = parseFloat(item.price) * quantity;
      await db.update(order_items).set({
        quantity,
        subtotal: newSubtotal.toFixed(2),
      }).where(eq(order_items.id, itemId));
    }

    const oldSubtotal = parseFloat(item.subtotal);
    const newSubtotalValue = quantity <= 0 ? 0 : parseFloat(item.price) * quantity;
    const newTotal = parseFloat(order.total_amount as any) - oldSubtotal + newSubtotalValue;
    await db.update(orders).set({ total_amount: newTotal.toFixed(2) }).where(eq(orders.id, orderId));

    const updatedOrder = await this.getOrderById(orderId);
    this.ordersGateway.notifyTableUpdate(order.table_id, updatedOrder);
    this.ordersGateway.notifyAllAdmins('orderUpdated', updatedOrder);
    return updatedOrder;
  }

  async updateOrderItemServed(orderId: number, itemId: number, served: boolean) {
    const order = await this.getOrderById(orderId);
    if (!['submitted', 'printed', 'unpaid'].includes(order.status)) {
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
    const order = await this.getOrderById(orderId);
    const updateData: any = { status: dto.status };

    if (dto.status === 'settled') {
      updateData.settled_at = new Date();
      await db.update(tables).set({ status: 'idle' }).where(eq(tables.id, order.table_id));
    }

    await db.update(orders).set(updateData).where(eq(orders.id, orderId));
    const updatedOrder = await this.getOrderById(orderId);
    this.ordersGateway.notifyOrderStatusChange(order.table_id, updatedOrder);
    this.ordersGateway.notifyAllAdmins('orderStatusChanged', updatedOrder);
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
      await db.update(orders).set({
        status: 'printed',
        printed_at: new Date(),
      }).where(eq(orders.id, orderId));
    } catch (err) {
      // 状态标记失败不影响主流程；mop 真打印走独立路径不依赖此状态
      console.error('[orders] markOrderAsPrinted failed:', (err as Error).message);
    }
  }

  async deleteOrder(orderId: number) {
    const order = await this.getOrderById(orderId);
    if (order.status !== 'draft') {
      throw new BadRequestException('只能删除草稿状态的订单');
    }

    await db.delete(order_items).where(eq(order_items.order_id, orderId));
    await db.delete(orders).where(eq(orders.id, orderId));

    const tableResult = await db.select().from(tables).where(eq(tables.id, order.table_id));
    const activeOrders = await db.select().from(orders)
      .where(and(
        eq(orders.table_id, order.table_id),
        inArray(orders.status, ['draft', 'submitted', 'printed'])
      ));
    if (activeOrders.length === 0 && tableResult.length > 0) {
      await db.update(tables).set({ status: 'idle' }).where(eq(tables.id, order.table_id));
    }

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
