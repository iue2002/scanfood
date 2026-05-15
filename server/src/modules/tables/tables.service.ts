import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { tables, orders, order_items } from '@/storage/database/shared/schema';
import { CreateTableDto, UpdateTableDto } from './dto/table.dto';
import { eq, asc, and, inArray, desc } from 'drizzle-orm';
import { WechatService } from '@/modules/wechat/wechat.service';

@Injectable()
export class TablesService {
  constructor(
    @Inject(WechatService)
    private readonly wechatService: WechatService,
  ) {}

  async getTables() {
    return await db.select().from(tables).orderBy(asc(tables.table_number));
  }

  async getTableBoard() {
    const tableList = await db.select().from(tables).orderBy(asc(tables.table_number));

    // 获取所有进行中的订单
    const activeOrders = await db.select().from(orders)
      .where(inArray(orders.status, ['submitted', 'printed']))
      .orderBy(desc(orders.created_at));

    const orderIds = activeOrders.map(o => o.id);
    let allItems: any[] = [];
    if (orderIds.length > 0) {
      allItems = await db.select().from(order_items).where(inArray(order_items.order_id, orderIds));
    }

    return tableList.map(t => {
      const order = activeOrders.find(o => o.table_id === t.id) || null;
      const items = order ? allItems.filter(i => i.order_id === order.id) : [];
      return {
        ...t,
        current_order: order ? { ...order, order_items: items } : null,
      };
    });
  }

  async getTableById(id: number) {
    const result = await db.select().from(tables).where(eq(tables.id, id));
    const table = result[0];
    if (!table) throw new NotFoundException('桌台不存在');
    return table;
  }

  async getTableByNumber(tableNumber: string) {
    const result = await db.select().from(tables).where(eq(tables.table_number, tableNumber));
    const table = result[0];
    if (!table) throw new NotFoundException('桌台不存在');
    return table;
  }

  async createTable(dto: CreateTableDto) {
    // 先插入数据，设置一个临时URL
    const insertResult = await db.insert(tables).values({
      ...dto,
      qr_code_url: '',
      status: 'idle',
    });
    const newId = (insertResult as any)[0].insertId;
    // 立即生成真正的二维码
    return await this.generateQrCode(newId);
  }

  async updateTable(id: number, dto: UpdateTableDto) {
    await db.update(tables).set(dto).where(eq(tables.id, id));
    return await this.getTableById(id);
  }

  async updateTableStatus(id: number, status: 'idle' | 'occupied' | 'settled') {
    await db.update(tables).set({ status }).where(eq(tables.id, id));
    return await this.getTableById(id);
  }

  async deleteTable(id: number) {
    await db.delete(tables).where(eq(tables.id, id));
    return { message: '删除成功' };
  }

  async generateQrCode(id: number) {
    const table = await this.getTableById(id);
    
    const scene = `id=${table.id}`;
    const page = 'pages/order/order';
    
    try {
      console.log('生成微信小程序码...');
      const qrCodeUrl = await this.wechatService.generateQrCode(scene, page, 430);
      await db.update(tables).set({ qr_code_url: qrCodeUrl }).where(eq(tables.id, id));
      console.log('微信小程序码生成成功');
      return await this.getTableById(id);
    } catch (error) {
      console.error('微信小程序码生成失败:', error.message);
      throw error;
    }
  }
}
