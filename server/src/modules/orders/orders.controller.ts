import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto, SyncAddMoreDto, AddOrderItemDto, UpdateOrderStatusDto, UpdateOrderItemServedDto } from './dto/order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { Audit } from '../merchant-ops/auth/decorators';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly storeSettingsService: StoreSettingsService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('current/:tableId')
  async getTableCurrentOrder(@Param('tableId', ParseIntPipe) tableId: number) {
    console.log('[GET /api/orders/current/:tableId]', { tableId });
    const result = await this.ordersService.getTableCurrentOrder(tableId);
    const settings = await this.storeSettingsService.getStoreSettings();
    return { ...result, store_name: settings.store_name, store_avatar: settings.store_avatar };
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-active')
  async getMyActiveOrder(@Req() req) {
    console.log('[GET /api/orders/my-active]', { userId: req.user?.userId });
    const result = await this.ordersService.getMyActiveOrder(req.user?.userId);
    const settings = await this.storeSettingsService.getStoreSettings();
    if (result) {
      return {
        ...result,
        store_name: settings.store_name,
        store_avatar: settings.store_avatar,
      };
    }
    return result;
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
    @Body() dto: SyncAddMoreDto,
  ) {
    console.log('[POST /api/orders/:id/sync-add-more]', { id, dto });
    return await this.ordersService.syncAddMore(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async getOrders(
    @Query('status') status?: string,
    @Query('exclude_draft') excludeDraft?: string,
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
    const skipDraft = !status && excludeDraft === 'true';
    console.log('[GET /api/orders]', JSON.parse(JSON.stringify({ status, excludeDraft, tableId: tableIdNum, dateFrom, dateTo, tag, page: pageNum, page_size: size })));
    const data = await this.ordersService.getOrders(status, tableIdNum, dateFrom, dateTo, tag, pageNum, size, skipDraft);
    const settings = await this.storeSettingsService.getStoreSettings();
    return {
      data,
      store_name: settings?.store_name || '伊美轩',
      store_avatar: settings?.store_avatar || '',
    };
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
  @Audit('ORDER_ADD_ITEM', { targetType: 'order' })
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
  @Put(':id/items/:itemId')
  async updateOrderItemQuantity(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body('quantity') quantity: number,
  ) {
    console.log('[PUT /api/orders/:id/items/:itemId]', { id, itemId, quantity });
    return await this.ordersService.updateOrderItemQuantity(id, itemId, quantity);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/items/:itemId/served')
  async updateOrderItemServed(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateOrderItemServedDto,
  ) {
    console.log('[POST /api/orders/:id/items/:itemId/served]', { id, itemId, dto });
    return await this.ordersService.updateOrderItemServed(id, itemId, dto.served);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/status')
  @Audit('ORDER_CHECKOUT', { targetType: 'order' })
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
