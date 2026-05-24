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
  users,
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
        total_amount: orders.total_amount,
        remark: orders.remark,
        created_at: orders.created_at,
        table_number: tables.table_number,
        operator_user: users.username,
        operator_nick: users.nickname,
      })
      .from(orders)
      .leftJoin(tables, eq(tables.id, orders.table_id))
      .leftJoin(users, eq(users.id, orders.user_id))
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
      store_name: storeName,
      created_at: h.created_at as Date,
      total_amount: Number(h.total_amount ?? 0),
      remark: h.remark ?? null,
      operator: h.operator_nick || h.operator_user || null,
      items: items.map((it) => ({
        name: it.name,
        spec: it.spec ?? null,
        quantity: it.quantity,
        subtotal: Number(it.subtotal ?? 0),
      })),
    };
  }
}
