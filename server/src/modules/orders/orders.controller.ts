import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto, AddOrderItemDto, UpdateOrderStatusDto } from './dto/order.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // 获取桌台当前订单（扫码进入时使用）
  @Get('current/:tableId')
  async getTableCurrentOrder(@Param('tableId', ParseIntPipe) tableId: number) {
    console.log('[GET /api/orders/current/:tableId]', { tableId });
    return await this.ordersService.getTableCurrentOrder(tableId);
  }

  // 获取所有订单（管理后台）
  @Get()
  async getOrders(
    @Query('status') status?: string,
    @Query('table_id') tableId?: string,
  ) {
    console.log('[GET /api/orders]', { status, tableId });
    const tableIdNum = tableId ? parseInt(tableId, 10) : undefined;
    return await this.ordersService.getOrders(status, tableIdNum);
  }

  // 获取订单详情
  @Get(':id')
  async getOrderById(@Param('id', ParseIntPipe) id: number) {
    console.log('[GET /api/orders/:id]', { id });
    return await this.ordersService.getOrderById(id);
  }

  // 创建订单（下单）
  @Post()
  async createOrder(@Body() dto: CreateOrderDto) {
    console.log('[POST /api/orders]', dto);
    return await this.ordersService.createOrder(dto);
  }

  // 加餐
  @Post(':id/items')
  async addOrderItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddOrderItemDto,
  ) {
    console.log('[POST /api/orders/:id/items]', { id, dto });
    return await this.ordersService.addOrderItem(id, dto);
  }

  // 减餐
  @Delete(':id/items/:itemId')
  async removeOrderItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Query('quantity') quantity?: string,
  ) {
    console.log('[DELETE /api/orders/:id/items/:itemId]', { id, itemId, quantity });
    const qty = quantity ? parseInt(quantity, 10) : undefined;
    return await this.ordersService.removeOrderItem(id, itemId, qty);
  }

  // 更新订单状态（结账、取消等）
  @Post(':id/status')
  async updateOrderStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    console.log('[POST /api/orders/:id/status]', { id, dto });
    return await this.ordersService.updateOrderStatus(id, dto);
  }
}
