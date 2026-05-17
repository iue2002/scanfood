import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto, AddOrderItemDto, UpdateOrderStatusDto } from './dto/order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('current/:tableId')
  async getTableCurrentOrder(@Param('tableId', ParseIntPipe) tableId: number) {
    console.log('[GET /api/orders/current/:tableId]', { tableId });
    return await this.ordersService.getTableCurrentOrder(tableId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-active')
  async getMyActiveOrder(@Req() req) {
    console.log('[GET /api/orders/my-active]', { userId: req.user?.userId });
    return await this.ordersService.getMyActiveOrder(req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sync-draft')
  async syncDraft(@Body() dto: CreateOrderDto) {
    console.log('[POST /api/orders/sync-draft]', dto);
    return await this.ordersService.syncDraft(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/sync-add-more')
  async syncAddMore(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { items: Array<{ dish_id: number; spec_id?: number; dish_name: string; spec_name?: string; quantity: number; price: number; added_by_user_id?: number; added_by_nickname?: string }> },
  ) {
    console.log('[POST /api/orders/:id/sync-add-more]', { id, dto });
    return await this.ordersService.syncAddMore(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async getOrders(
    @Query('status') status?: string,
    @Query('table_id') tableId?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
    @Query('tag') tag?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const size = pageSize ? parseInt(pageSize, 10) : 20;
    const tableIdNum = tableId ? parseInt(tableId, 10) : undefined;
    console.log('[GET /api/orders]', { status, tableId: tableIdNum, dateFrom, dateTo, tag, page: pageNum, page_size: size });
    return await this.ordersService.getOrders(status, tableIdNum, dateFrom, dateTo, tag, pageNum, size);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getOrderById(@Param('id', ParseIntPipe) id: number) {
    console.log('[GET /api/orders/:id]', { id });
    return await this.ordersService.getOrderById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async createOrder(@Body() dto: CreateOrderDto) {
    console.log('[POST /api/orders]', dto);
    return await this.ordersService.createOrder(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/items')
  async addOrderItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddOrderItemDto,
  ) {
    console.log('[POST /api/orders/:id/items]', { id, dto });
    return await this.ordersService.addOrderItem(id, dto);
  }

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
  @Post(':id/status')
  async updateOrderStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    console.log('[POST /api/orders/:id/status]', { id, dto });
    return await this.ordersService.updateOrderStatus(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteOrder(@Param('id', ParseIntPipe) id: number) {
    console.log('[DELETE /api/orders/:id]', { id });
    return await this.ordersService.deleteOrder(id);
  }
}
