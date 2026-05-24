/**
 * 打印预览 / 试打印的样本数据源
 *
 * 优先从真实库读：店名 + 任意 2-3 个真实菜品（按 sort_order 升序），
 * 没数据时让 PrintCore 自己用通用占位（"示例商品 A/B"），不绑定具体业态。
 */
import { Injectable, Logger } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { dishes, store_settings } from '@/storage/database/shared/schema';
import { asc, eq } from 'drizzle-orm';
import type { PreviewSampleProvider } from './print.core';

@Injectable()
export class DrizzlePreviewSampleProvider implements PreviewSampleProvider {
  private readonly logger = new Logger(DrizzlePreviewSampleProvider.name);

  async getStoreName(): Promise<string | null> {
    try {
      const rows = await db.select({ name: store_settings.store_name }).from(store_settings).limit(1);
      return rows[0]?.name ?? null;
    } catch (err) {
      this.logger.warn(`[preview-sample] read store_name failed: ${(err as Error).message}`);
      return null;
    }
  }

  async getSampleItems(): Promise<Array<{ name: string; spec: string | null; quantity: number; subtotal: number }>> {
    try {
      const rows = await db
        .select({ name: dishes.name, price: dishes.price })
        .from(dishes)
        .where(eq(dishes.status, 'available'))
        .orderBy(asc(dishes.sort_order))
        .limit(3);
      if (rows.length === 0) return [];
      // 第一个菜品 x2，其余 x1，营造真实订单感
      return rows.map((r, i) => {
        const quantity = i === 0 ? 2 : 1;
        const price = Number(r.price ?? 0);
        return {
          name: r.name,
          spec: null,
          quantity,
          subtotal: Number((price * quantity).toFixed(2)),
        };
      });
    } catch (err) {
      this.logger.warn(`[preview-sample] read dishes failed: ${(err as Error).message}`);
      return [];
    }
  }
}
