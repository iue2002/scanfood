import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { OrdersService } from './orders.service';
import type { OrderActor } from './orders.service';
import { CreateOrderDto, SyncAddMoreDto, AddOrderItemDto, UpdateOrderStatusDto, UpdateOrderItemServedDto } from './dto/order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { Audit, Permissions } from '../merchant-ops/auth/decorators';
import { PermissionsGuard } from '../merchant-ops/auth/permissions.guard';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly storeSettingsService: StoreSettingsService,
  ) {}

  /** 从 JWT 提取访问者上下文，用于顾客端点的订单归属校验（防 IDOR 越权） */
  private buildActor(req: any): OrderActor {
    return { userId: req?.user?.userId, role: req?.user?.role };
  }

  // ---- 顾客端点（小程序用） ----

  @UseGuards(JwtAuthGuard)
  @Get('current/:tableId')
  async getTableCurrentOrder(@Param('tableId', ParseIntPipe) tableId: number) {
    const result = await this.ordersService.getTableCurrentOrder(tableId);
    const settings = await this.storeSettingsService.getStoreSettings();
    return { ...result, store_name: settings.store_name, store_avatar: settings.store_avatar };
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-active')
  async getMyActiveOrder(@Req() req) {
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
    return await this.ordersService.syncDraft(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getOrderById(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return await this.ordersService.getOrderByIdForActor(id, this.buildActor(req));
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async createOrder(@Body() dto: CreateOrderDto) {
    return await this.ordersService.createOrder(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/items')
  async addOrderItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddOrderItemDto,
    @Req() req: any,
  ) {
    return await this.ordersService.addOrderItem(id, dto, this.buildActor(req));
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/items/:itemId')
  async removeOrderItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Req() req: any,
    @Query('quantity') quantity?: string,
  ) {
    const qty = quantity ? parseInt(quantity, 10) : undefined;
    return await this.ordersService.removeOrderItem(id, itemId, qty, this.buildActor(req));
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/items/:itemId')
  async updateOrderItemQuantity(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body('quantity') quantity: number,
    @Req() req: any,
  ) {
    return await this.ordersService.updateOrderItemQuantity(id, itemId, quantity, this.buildActor(req));
  }

  // ---- 商家端点（RBAC 保护） ----

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ORDER_READ')
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
    @Query('search') search?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const size = pageSize ? parseInt(pageSize, 10) : 20;
    const tableIdNum = tableId ? parseInt(tableId, 10) : undefined;
    const skipDraft = !status && excludeDraft === 'true';
    const data = await this.ordersService.getOrders(status, tableIdNum, dateFrom, dateTo, tag, pageNum, size, skipDraft, search);
    const settings = await this.storeSettingsService.getStoreSettings();
    return {
      data,
      store_name: settings?.store_name || '我的小店',
      store_avatar: settings?.store_avatar || '',
    };
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ORDER_ADD_ITEM')
  @Audit('ORDER_ADD_ITEM', { targetType: 'order' })
  @Post(':id/sync-add-more')
  async syncAddMore(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SyncAddMoreDto,
  ) {
    return await this.ordersService.syncAddMore(id, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ORDER_MARK_SERVED')
  @Audit('ORDER_MARK_SERVED', { targetType: 'order' })
  @Post(':id/items/:itemId/served')
  async updateOrderItemServed(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateOrderItemServedDto,
  ) {
    return await this.ordersService.updateOrderItemServed(id, itemId, dto.served);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ORDER_CHECKOUT')
  @Audit('ORDER_CHECKOUT', { targetType: 'order' })
  @Post(':id/status')
  async updateOrderStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return await this.ordersService.updateOrderStatus(id, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('ORDER_DELETE_DRAFT')
  @Audit('ORDER_DELETE_DRAFT', { targetType: 'order' })
  @Delete(':id')
  async deleteOrder(@Param('id', ParseIntPipe) id: number) {
    return await this.ordersService.deleteOrder(id);
  }
}
