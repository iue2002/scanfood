import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { orders, order_items, tables, users, print_records } from '@/storage/database/shared/schema';
import { CreateOrderDto, AddOrderItemDto, UpdateOrderStatusDto } from './dto/order.dto';
import { eq, and, inArray, desc } from 'drizzle-orm';

@Injectable()
export class OrdersService {
  private generateOrderNumber(): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = Date.now().toString().slice(-6);
    return `ORD${dateStr}${timeStr}`;
  }

  async getTableCurrentOrder(tableId: number) {
    const result = await db.select().from(orders)
      .where(and(
        eq(orders.table_id, tableId),
        inArray(orders.status, ['submitted', 'printed'])
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

  async getOrders(status?: string, tableId?: number) {
    let query = db.select().from(orders).orderBy(desc(orders.created_at)) as any;

    const conditions: any[] = [];
    if (status) conditions.push(eq(orders.status, status));
    if (tableId) conditions.push(eq(orders.table_id, tableId));

    let orderList;
    if (conditions.length > 0) {
      orderList = await db.select().from(orders).where(and(...conditions)).orderBy(desc(orders.created_at));
    } else {
      orderList = await db.select().from(orders).orderBy(desc(orders.created_at));
    }

    const tableList = await db.select().from(tables);
    const userList = await db.select().from(users);

    return orderList.map(o => ({
      ...o,
      tables: tableList.find(t => t.id === o.table_id) || null,
      users: userList.find(u => u.id === o.user_id) || null,
    }));
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

    const insertResult = await db.insert(orders).values({
      table_id: dto.table_id,
      order_number: orderNumber,
      total_amount: totalAmount.toFixed(2),
      user_id: dto.user_id,
      remark: dto.remark,
      status: 'submitted',
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
    }));

    await db.insert(order_items).values(itemsToInsert);
    await db.update(tables).set({ status: 'occupied' }).where(eq(tables.id, dto.table_id));

    this.printReceipt(orderId).catch(err => {
      console.error('打印小票失败:', err);
    });

    return await this.getOrderById(orderId);
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
    });

    const newTotal = parseFloat(order.total_amount as any) + subtotal;
    await db.update(orders).set({ total_amount: newTotal.toFixed(2) }).where(eq(orders.id, orderId));

    this.printReceipt(orderId).catch(err => {
      console.error('打印小票失败:', err);
    });

    return await this.getOrderById(orderId);
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

    return await this.getOrderById(orderId);
  }

  async updateOrderStatus(orderId: number, dto: UpdateOrderStatusDto) {
    const order = await this.getOrderById(orderId);
    const updateData: any = { status: dto.status };

    if (dto.status === 'settled') {
      updateData.settled_at = new Date();
      await db.update(tables).set({ status: 'idle' }).where(eq(tables.id, order.table_id));
    }

    await db.update(orders).set(updateData).where(eq(orders.id, orderId));
    return await this.getOrderById(orderId);
  }

  private async printReceipt(orderId: number) {
    const order = await this.getOrderById(orderId);
    const insertResult = await db.insert(print_records).values({
      order_id: orderId,
      status: 'pending',
    });
    const printId = (insertResult as any)[0].insertId;

    try {
      console.log('打印小票:', {
        order_number: order.order_number,
        table_number: order.tables?.table_number,
        items: order.order_items,
        total: order.total_amount,
      });

      await db.update(print_records).set({
        status: 'success',
        printed_at: new Date(),
      }).where(eq(print_records.id, printId));

      await db.update(orders).set({
        status: 'printed',
        printed_at: new Date(),
      }).where(eq(orders.id, orderId));
    } catch (err) {
      await db.update(print_records).set({
        status: 'failed',
        error_message: String(err),
      }).where(eq(print_records.id, printId));
    }
  }
}
