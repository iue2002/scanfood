import { Injectable, BadRequestException, NotFoundException, Inject, Logger } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { tables, orders, order_items, table_validations } from '@/storage/database/shared/schema';
import { CreateTableDto, UpdateTableDto } from './dto/table.dto';
import { eq, asc, and, inArray, desc, ne } from 'drizzle-orm';
import { WechatService } from '@/modules/wechat/wechat.service';
import { LocalImageCleanupService } from '@/modules/merchant-ops/common/image-cleanup';

const TAKEAWAY_TABLE_NUMBER = '__TAKEAWAY__';

@Injectable()
export class TablesService {
  constructor(
    @Inject(WechatService)
    private readonly wechatService: WechatService,
    private readonly imageCleanup: LocalImageCleanupService,
  ) {}

  async getTables() {
    // 隐藏虚拟外带桌，避免管理后台桌台列表里出现
    return await db.select().from(tables)
      .where(ne(tables.table_number, TAKEAWAY_TABLE_NUMBER))
      .orderBy(asc(tables.table_number));
  }

  async getTableBoard() {
    const tableList = await db.select().from(tables)
      .where(ne(tables.table_number, TAKEAWAY_TABLE_NUMBER))
      .orderBy(asc(tables.table_number));

    const activeOrders = await db.select().from(orders)
      .where(inArray(orders.status, ['submitted', 'printed', 'unpaid']))
      .orderBy(desc(orders.created_at));

    const orderIds = activeOrders.map(o => o.id);
    let allItems: any[] = [];
    if (orderIds.length > 0) {
      allItems = await db.select().from(order_items).where(inArray(order_items.order_id, orderIds));
    }

    const result = tableList.map(t => {
      const order = activeOrders.find(o => o.table_id === t.id) || null;
      const items = order ? allItems.filter(i => i.order_id === order.id) : [];
      return {
        ...t,
        current_order: order ? { ...order, order_items: items } : null,
      };
    });

    return { data: result };
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
    // 检查桌台编号是否已存在
    const existing = await db.select().from(tables).where(eq(tables.table_number, dto.table_number));
    if (existing.length > 0) {
      throw new BadRequestException('桌台编号已存在');
    }
    // 桌台 + 桌号验证表：两步必须一致，包进事务原子写入
    // （二维码生成走外部微信 API、可能慢/失败，放事务外，避免长事务；失败可后续重新生成）
    const newId = await db.transaction(async (tx) => {
      const insertResult = await tx.insert(tables).values({
        ...dto,
        qr_code_url: '',
        status: 'idle',
      });
      const id = (insertResult as any)[0].insertId;
      await tx.insert(table_validations).values({
        table_number: dto.table_number,
        table_id: id,
      });
      return id as number;
    });

    // 立即生成真正的二维码（事务外）
    return await this.generateQrCode(newId);
  }

  async updateTable(id: number, dto: UpdateTableDto) {
    // 如果更新了桌号，需要同步更新验证表
    if (dto.table_number) {
      const existing = await db.select().from(tables).where(eq(tables.id, id));
      if (existing.length === 0) throw new NotFoundException('桌台不存在');

      const oldTableNumber = existing[0].table_number;
      if (dto.table_number !== oldTableNumber) {
        // 检查新桌号是否已被占用
        const duplicate = await db.select().from(tables).where(eq(tables.table_number, dto.table_number));
        if (duplicate.length > 0) {
          throw new BadRequestException('桌台编号已存在');
        }
        // 同步更新验证表中的桌号
        await db.update(table_validations)
          .set({ table_number: dto.table_number })
          .where(eq(table_validations.table_id, id));
      }
    }

    await db.update(tables).set(dto).where(eq(tables.id, id));
    return await this.getTableById(id);
  }

  async updateTableStatus(id: number, status: 'idle' | 'occupied' | 'settled') {
    await db.update(tables).set({ status }).where(eq(tables.id, id));
    return await this.getTableById(id);
  }

  async deleteTable(id: number) {
    // 先读 qr_code_url，删完表行后再清理本地二维码图片
    const cur = await db.select({ qr_code_url: tables.qr_code_url }).from(tables).where(eq(tables.id, id)).limit(1);
    const qrUrl = cur[0]?.qr_code_url ?? null;
    // 同步删除验证表中的记录（外键 onDelete:cascade 也会处理，但显式删除更安全）
    await db.delete(table_validations).where(eq(table_validations.table_id, id));
    await db.delete(tables).where(eq(tables.id, id));
    if (qrUrl) {
      void this.imageCleanup.removeByUrl(qrUrl); // fire-and-forget
    }
    return { message: '删除成功' };
  }

  async generateQrCode(id: number) {
    const table = await this.getTableById(id);
    const oldQr = table.qr_code_url ?? null;

    // scene 参数：桌台编号（不加前缀）
    const scene = table.table_number;
    const page = 'pages/order/order';

    try {
      // 先尝试使用 createQRCode 接口（对未发布小程序更友好），失败降级到 getUnlimited
      let qrCodeUrl;
      try {
        qrCodeUrl = await this.wechatService.createQRCode(scene, page, 430);
      } catch (error) {
        qrCodeUrl = await this.wechatService.generateQrCode(scene, page, 430);
      }
      await db.update(tables).set({ qr_code_url: qrCodeUrl }).where(eq(tables.id, id));
      // 旧二维码替换：清理上一份本地文件
      if (oldQr && oldQr !== qrCodeUrl) {
        void this.imageCleanup.removeByUrl(oldQr);
      }
      return await this.getTableById(id);
    } catch (error) {
      const logger = new Logger(TablesService.name);
      logger.error(`微信小程序码生成失败: ${(error as Error).message}`);
      throw error;
    }
  }

  // 验证桌号是否有效（扫码时使用）
  async validateTableNumber(tableNumber: string) {
    const result = await db.select().from(table_validations).where(eq(table_validations.table_number, tableNumber));
    if (result.length === 0) {
      return { valid: false, message: '桌号无效，该桌号不存在或已被删除' };
    }
    return { valid: true, message: '桌号有效' };
  }
}
