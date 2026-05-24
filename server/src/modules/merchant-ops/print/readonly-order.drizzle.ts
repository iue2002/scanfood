/**
 * 独立的订单只读投影（仅服务于 PrintCore）
 * DI-7：不依赖 OrdersService；纯 SQL JOIN
 */
import { Injectable } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import {
  orders,
  order_items,
  tables,
  store_settings,
} from '@/storage/database/shared/schema';
import { asc, eq } from 'drizzle-orm';
import type { OrderProjection } from './print.types';

@Injectable()
export class PrintOrderReader {
  async readOrder(orderId: number): Promise<OrderProjection | null> {
    const head = await db
      .select({
        id: orders.id,
        order_number: orders.order_number,
        order_type: orders.order_type,
        total_amount: orders.total_amount,
        remark: orders.remark,
        created_at: orders.created_at,
        table_number: tables.table_number,
      })
      .from(orders)
      .leftJoin(tables, eq(tables.id, orders.table_id))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (head.length === 0) return null;
    const h = head[0];
    const items = await db
      .select({
        name: order_items.dish_name,
        spec: order_items.spec_name,
        quantity: order_items.quantity,
        subtotal: order_items.subtotal,
      })
      .from(order_items)
      .where(eq(order_items.order_id, orderId))
      .orderBy(asc(order_items.id));

    let storeName = '小店';
    try {
      const store = await db.select({ name: store_settings.store_name }).from(store_settings).limit(1);
      if (store[0]?.name) storeName = store[0].name;
    } catch { /* ignore */ }

    return {
      order_id: h.id,
      order_no: h.order_number,
      table_number: h.table_number ?? '-',
      order_type: h.order_type || 'dine_in',
      store_name: storeName,
      created_at: h.created_at as Date,
      total_amount: Number(h.total_amount ?? 0),
      remark: h.remark ?? null,
      // 当前库里没有"哪个员工处理订单"的字段；
      // 不要把订单的 user_id（顾客）当 operator —— 那是顾客微信昵称，打到小票上是错的。
      // 等以后 orders 表加 settled_by_employee_id 等字段再 join 真正的员工 nickname。
      operator: null,
      items: items.map((it) => ({
        name: it.name,
        spec: it.spec ?? null,
        quantity: it.quantity,
        subtotal: Number(it.subtotal ?? 0),
      })),
    };
  }
}
