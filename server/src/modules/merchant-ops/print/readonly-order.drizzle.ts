/**
 * 独立的订单只读投影（仅服务于 PrintCore）
 * DI-7：不依赖 OrdersService；纯 SQL JOIN
 *
 * 关键字段：
 *  - items[].order_item_id：选购打印用
 *  - items[].category_id：plan slice 分类过滤用（join dishes 拿）
 *  - items[].phase / add_more_round：加餐自动打印 diff 用
 *  - order_type：渲染时区分堂食/外带
 *  - operator：始终 null（业务库里没"操作员"字段；不要拿顾客昵称冒充）
 */
import { Injectable } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import {
  orders,
  order_items,
  tables,
  dishes,
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
        pickup_no: orders.pickup_no,
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

    // join dishes 拿 category_id（dish 删了也能 fallback 到 0/null，由 PrintCore 兜底）
    const items = await db
      .select({
        order_item_id: order_items.id,
        name: order_items.dish_name,
        spec: order_items.spec_name,
        quantity: order_items.quantity,
        subtotal: order_items.subtotal,
        category_id: dishes.category_id,
        phase: order_items.phase,
        add_more_round: order_items.add_more_round,
      })
      .from(order_items)
      .leftJoin(dishes, eq(dishes.id, order_items.dish_id))
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
      pickup_no: h.pickup_no ?? null,
      order_type: h.order_type || 'dine_in',
      store_name: storeName,
      created_at: h.created_at as Date,
      total_amount: Number(h.total_amount ?? 0),
      remark: h.remark ?? null,
      // 不要把顾客 user_id 当 operator —— 那是微信昵称，会泄漏顾客身份
      operator: null,
      items: items.map((it) => ({
        order_item_id: it.order_item_id,
        category_id: it.category_id ?? 0,  // dish 已删（外键 NO ACTION 实际不会发生）：用 0 标识，PrintCore 走兜底
        name: it.name,
        spec: it.spec ?? null,
        quantity: it.quantity,
        subtotal: Number(it.subtotal ?? 0),
        phase: (it.phase === 'add_more' ? 'add_more' : 'order') as 'order' | 'add_more',
        add_more_round: it.add_more_round ?? 0,
      })),
    };
  }
}
