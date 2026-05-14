import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { CreateOrderDto, UpdateOrderDto, AddOrderItemDto, UpdateOrderStatusDto } from './dto/order.dto';

@Injectable()
export class OrdersService {
  private client = getSupabaseClient();

  // 生成订单号
  private generateOrderNumber(): string {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = Date.now().toString().slice(-6);
    return `ORD${dateStr}${timeStr}`;
  }

  // 获取桌台当前订单（未结账的订单）
  async getTableCurrentOrder(tableId: number) {
    const { data, error } = await this.client
      .from('orders')
      .select(`
        *,
        tables(table_number, capacity),
        order_items(*)
      `)
      .eq('table_id', tableId)
      .in('status', ['submitted', 'printed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new BadRequestException(`获取订单失败: ${error.message}`);
    return data; // 可能为null，表示桌台没有当前订单
  }

  // 获取所有订单（管理后台）
  async getOrders(status?: string, tableId?: number) {
    let query = this.client
      .from('orders')
      .select(`
        *,
        tables(table_number),
        users(username, nickname)
      `)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }
    if (tableId) {
      query = query.eq('table_id', tableId);
    }

    const { data, error } = await query;

    if (error) throw new BadRequestException(`获取订单失败: ${error.message}`);
    return data;
  }

  // 获取订单详情
  async getOrderById(id: number) {
    const { data, error } = await this.client
      .from('orders')
      .select(`
        *,
        tables(table_number, capacity),
        users(username, nickname),
        order_items(*)
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(`获取订单失败: ${error.message}`);
    if (!data) throw new NotFoundException('订单不存在');

    return data;
  }

  // 创建订单
  async createOrder(dto: CreateOrderDto) {
    // 计算总金额
    let totalAmount = 0;
    const orderItems = dto.items.map(item => {
      const subtotal = item.price * item.quantity;
      totalAmount += subtotal;
      return {
        ...item,
        subtotal,
      };
    });

    const orderNumber = this.generateOrderNumber();

    // 创建订单
    const { data: order, error: orderError } = await this.client
      .from('orders')
      .insert({
        table_id: dto.table_id,
        order_number: orderNumber,
        total_amount: totalAmount.toFixed(2),
        user_id: dto.user_id,
        remark: dto.remark,
        status: 'submitted',
      })
      .select()
      .single();

    if (orderError) throw new BadRequestException(`创建订单失败: ${orderError.message}`);

    // 创建订单明细
    const itemsToInsert = orderItems.map(item => ({
      order_id: order.id,
      dish_id: item.dish_id,
      spec_id: item.spec_id,
      dish_name: item.dish_name,
      spec_name: item.spec_name,
      quantity: item.quantity,
      price: item.price.toFixed(2),
      subtotal: item.subtotal.toFixed(2),
    }));

    const { error: itemsError } = await this.client
      .from('order_items')
      .insert(itemsToInsert);

    if (itemsError) throw new BadRequestException(`创建订单明细失败: ${itemsError.message}`);

    // 更新桌台状态为占用
    await this.client
      .from('tables')
      .update({ status: 'occupied', updated_at: new Date().toISOString() })
      .eq('id', dto.table_id);

    // 触发小票打印（异步，不阻塞）
    this.printReceipt(order.id).catch(err => {
      console.error('打印小票失败:', err);
    });

    return this.getOrderById(order.id);
  }

  // 加餐（添加菜品到当前订单）
  async addOrderItem(orderId: number, dto: AddOrderItemDto) {
    const order = await this.getOrderById(orderId);

    if (!['submitted', 'printed'].includes(order.status)) {
      throw new BadRequestException('订单状态不允许添加菜品');
    }

    const subtotal = dto.price * dto.quantity;

    const { error } = await this.client
      .from('order_items')
      .insert({
        order_id: orderId,
        dish_id: dto.dish_id,
        spec_id: dto.spec_id,
        dish_name: dto.dish_name,
        spec_name: dto.spec_name,
        quantity: dto.quantity,
        price: dto.price.toFixed(2),
        subtotal: subtotal.toFixed(2),
      });

    if (error) throw new BadRequestException(`添加菜品失败: ${error.message}`);

    // 更新订单总金额
    const newTotal = parseFloat(order.total_amount) + subtotal;
    await this.client
      .from('orders')
      .update({
        total_amount: newTotal.toFixed(2),
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    // 重新打印小票
    this.printReceipt(orderId).catch(err => {
      console.error('打印小票失败:', err);
    });

    return this.getOrderById(orderId);
  }

  // 减餐（减少或删除菜品）
  async removeOrderItem(orderId: number, itemId: number, quantity?: number) {
    const order = await this.getOrderById(orderId);

    if (!['submitted', 'printed'].includes(order.status)) {
      throw new BadRequestException('订单状态不允许修改');
    }

    const item = order.order_items.find(i => i.id === itemId);
    if (!item) throw new NotFoundException('订单明细不存在');

    if (quantity && quantity < item.quantity) {
      // 减少数量
      const newQuantity = item.quantity - quantity;
      const newSubtotal = parseFloat(item.price) * newQuantity;

      const { error } = await this.client
        .from('order_items')
        .update({
          quantity: newQuantity,
          subtotal: newSubtotal.toFixed(2),
        })
        .eq('id', itemId);

      if (error) throw new BadRequestException(`更新失败: ${error.message}`);

      // 更新总金额
      const diff = parseFloat(item.price) * quantity;
      const newTotal = parseFloat(order.total_amount) - diff;
      await this.client
        .from('orders')
        .update({
          total_amount: newTotal.toFixed(2),
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId);
    } else {
      // 删除整项
      const { error } = await this.client
        .from('order_items')
        .delete()
        .eq('id', itemId);

      if (error) throw new BadRequestException(`删除失败: ${error.message}`);

      // 更新总金额
      const newTotal = parseFloat(order.total_amount) - parseFloat(item.subtotal);
      await this.client
        .from('orders')
        .update({
          total_amount: newTotal.toFixed(2),
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId);
    }

    return this.getOrderById(orderId);
  }

  // 更新订单状态（结账、取消等）
  async updateOrderStatus(orderId: number, dto: UpdateOrderStatusDto) {
    const order = await this.getOrderById(orderId);

    const updateData: any = {
      status: dto.status,
      updated_at: new Date().toISOString(),
    };

    if (dto.status === 'settled') {
      updateData.settled_at = new Date().toISOString();
      // 更新桌台状态为空闲
      await this.client
        .from('tables')
        .update({ status: 'idle', updated_at: new Date().toISOString() })
        .eq('id', order.table_id);
    }

    const { data, error } = await this.client
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single();

    if (error) throw new BadRequestException(`更新失败: ${error.message}`);
    return data;
  }

  // 打印小票
  private async printReceipt(orderId: number) {
    const order = await this.getOrderById(orderId);

    // 创建打印记录
    const { data: printRecord, error } = await this.client
      .from('print_records')
      .insert({
        order_id: orderId,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('创建打印记录失败:', error);
      return;
    }

    try {
      // TODO: 实际调用打印机硬件或打印服务
      console.log('打印小票:', {
        order_number: order.order_number,
        table_number: order.tables.table_number,
        items: order.order_items,
        total: order.total_amount,
      });

      // 更新打印记录为成功
      await this.client
        .from('print_records')
        .update({
          status: 'success',
          printed_at: new Date().toISOString(),
        })
        .eq('id', printRecord.id);

      // 更新订单状态为已打印
      await this.client
        .from('orders')
        .update({
          status: 'printed',
          printed_at: new Date().toISOString(),
        })
        .eq('id', orderId);
    } catch (err) {
      // 更新打印记录为失败
      await this.client
        .from('print_records')
        .update({
          status: 'failed',
          error_message: String(err),
        })
        .eq('id', printRecord.id);
    }
  }
}
