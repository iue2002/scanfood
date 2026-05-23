/**
 * ReadOnlyOrdersPort 的 Drizzle 只读投影实现
 *
 * 关键约束（DI-7）：完全独立 SQL；不 import OrdersService 任何方法。
 * 仅读取既有表（orders / order_items / tables / dishes / dish_categories / refunds / users），不改写它们。
 */
import { Injectable, Logger } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import {
  orders,
  order_items,
  tables,
  dishes,
  dish_categories,
  refunds,
  users,
} from '@/storage/database/shared/schema';
import { and, asc, between, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { ReadOnlyOrdersPort } from './export-repo.port';
import type {
  OrderExportRow,
  OrderStatusFilter,
  ReportAggregate,
  ReportType,
} from './export.types';

@Injectable()
export class DrizzleReadOnlyOrdersRepo implements ReadOnlyOrdersPort {
  private readonly logger = new Logger(DrizzleReadOnlyOrdersRepo.name);

  async countOrders(startAt: Date, endAt: Date, status?: OrderStatusFilter[]): Promise<number> {
    const conds: any[] = [between(orders.created_at, startAt, endAt)];
    if (status && status.length > 0) {
      conds.push(inArray(orders.status, status));
    }
    const r = await db.select({ c: sql<number>`count(*)` }).from(orders).where(and(...conds));
    return Number(r[0]?.c ?? 0);
  }

  async streamOrders(
    startAt: Date,
    endAt: Date,
    status: OrderStatusFilter[] | undefined,
    onBatch: (rows: OrderExportRow[]) => Promise<void>,
    batchSize = 500,
  ): Promise<{ totalRows: number }> {
    let offset = 0;
    let totalRows = 0;
    const conds: any[] = [between(orders.created_at, startAt, endAt)];
    if (status && status.length > 0) {
      conds.push(inArray(orders.status, status));
    }

    // 分批读 orders；每批再 join order_items / refunds / tables / users 聚合
    while (true) {
      const orderRows = await db
        .select({
          id: orders.id,
          order_number: orders.order_number,
          table_id: orders.table_id,
          order_type: orders.order_type,
          status: orders.status,
          total_amount: orders.total_amount,
          user_id: orders.user_id,
          created_at: orders.created_at,
          table_number: tables.table_number,
          operator_nick: users.nickname,
          operator_user: users.username,
        })
        .from(orders)
        .leftJoin(tables, eq(tables.id, orders.table_id))
        .leftJoin(users, eq(users.id, orders.user_id))
        .where(and(...conds))
        .orderBy(asc(orders.created_at))
        .limit(batchSize)
        .offset(offset);

      if (orderRows.length === 0) break;

      const orderIds = orderRows.map((r) => r.id);

      // order_items 聚合：每订单的菜品摘要
      const itemRows = await db
        .select({
          order_id: order_items.order_id,
          dish_name: order_items.dish_name,
          spec_name: order_items.spec_name,
          quantity: order_items.quantity,
        })
        .from(order_items)
        .where(inArray(order_items.order_id, orderIds));
      const itemSummary = new Map<number, string[]>();
      for (const it of itemRows) {
        const arr = itemSummary.get(it.order_id) ?? [];
        const name = it.spec_name ? `${it.dish_name}(${it.spec_name})` : it.dish_name;
        arr.push(`${name}x${it.quantity}`);
        itemSummary.set(it.order_id, arr);
      }

      // refunds 聚合：approved 累加
      const refundRows = await db
        .select({
          order_id: refunds.order_id,
          amount: refunds.amount,
          status: refunds.status,
        })
        .from(refunds)
        .where(inArray(refunds.order_id, orderIds));
      const refundAmt = new Map<number, number>();
      for (const rr of refundRows) {
        if (rr.status !== 'approved') continue;
        refundAmt.set(rr.order_id, (refundAmt.get(rr.order_id) ?? 0) + Number(rr.amount));
      }

      const projected: OrderExportRow[] = orderRows.map((r) => ({
        order_number: r.order_number,
        table_number: r.table_number ?? '-',
        order_type: r.order_type,
        created_at: r.created_at as Date,
        status: r.status,
        item_summary: (itemSummary.get(r.id) ?? []).join('; '),
        total_amount: Number(r.total_amount),
        refund_amount: refundAmt.get(r.id) ?? 0,
        operator: r.operator_nick || r.operator_user || '-',
      }));

      await onBatch(projected);

      totalRows += projected.length;
      offset += orderRows.length;
      if (orderRows.length < batchSize) break;
    }

    return { totalRows };
  }

  async aggregateForReport(
    type: ReportType,
    date: string,
    storeName: string,
    generatedBy: string,
  ): Promise<ReportAggregate> {
    // 计算时间窗口（本地时区零点起）
    const { startAt, endAt } = ReportRange(type, date);

    // 1) 订单总数（不含已取消）
    const ordCnt = await db
      .select({ c: sql<number>`count(*)` })
      .from(orders)
      .where(and(between(orders.created_at, startAt, endAt), sql`${orders.status} <> 'cancelled'`));
    const orderCount = Number(ordCnt[0]?.c ?? 0);

    // 2) 营业额：settled 总和
    const revRow = await db
      .select({ s: sql<number>`coalesce(sum(${orders.total_amount}), 0)` })
      .from(orders)
      .where(and(between(orders.created_at, startAt, endAt), eq(orders.status, 'settled')));
    const revenue = Number(revRow[0]?.s ?? 0);

    // 3) 退款额：approved
    const refRow = await db
      .select({ s: sql<number>`coalesce(sum(${refunds.amount}), 0)` })
      .from(refunds)
      .where(and(between(refunds.created_at, startAt, endAt), eq(refunds.status, 'approved')));
    const refundAmount = Number(refRow[0]?.s ?? 0);

    // 4) 桌均：revenue / 不重复 table_id 数（仅 settled）
    const tblRow = await db
      .select({ c: sql<number>`count(distinct ${orders.table_id})` })
      .from(orders)
      .where(and(between(orders.created_at, startAt, endAt), eq(orders.status, 'settled')));
    const tableCount = Number(tblRow[0]?.c ?? 0);
    const perTableAverage = tableCount > 0 ? revenue / tableCount : 0;

    // 5) 品类销量
    const catRows = await db
      .select({
        category: dish_categories.name,
        quantity: sql<number>`sum(${order_items.quantity})`,
        amount: sql<number>`sum(${order_items.subtotal})`,
      })
      .from(order_items)
      .innerJoin(orders, eq(order_items.order_id, orders.id))
      .innerJoin(dishes, eq(dishes.id, order_items.dish_id))
      .innerJoin(dish_categories, eq(dish_categories.id, dishes.category_id))
      .where(and(between(orders.created_at, startAt, endAt), sql`${orders.status} <> 'cancelled'`))
      .groupBy(dish_categories.name);
    const categorySales = catRows.map((r) => ({
      category: r.category,
      quantity: Number(r.quantity ?? 0),
      amount: Number(r.amount ?? 0),
    })).sort((a, b) => b.amount - a.amount);

    // 6) Top10 菜品
    const topRows = await db
      .select({
        name: order_items.dish_name,
        quantity: sql<number>`sum(${order_items.quantity})`,
        amount: sql<number>`sum(${order_items.subtotal})`,
      })
      .from(order_items)
      .innerJoin(orders, eq(order_items.order_id, orders.id))
      .where(and(between(orders.created_at, startAt, endAt), sql`${orders.status} <> 'cancelled'`))
      .groupBy(order_items.dish_name)
      .orderBy(sql`sum(${order_items.subtotal}) desc`)
      .limit(10);
    const topDishes = topRows.map((r) => ({
      name: r.name,
      quantity: Number(r.quantity ?? 0),
      amount: Number(r.amount ?? 0),
    }));

    // 7) 月报：按日趋势
    let dailyTrend: ReportAggregate['dailyTrend'];
    if (type === 'MONTHLY') {
      const trendRows = await db
        .select({
          d: sql<string>`date(${orders.created_at})`,
          c: sql<number>`count(*)`,
          s: sql<number>`coalesce(sum(case when ${orders.status} = 'settled' then ${orders.total_amount} else 0 end), 0)`,
        })
        .from(orders)
        .where(and(between(orders.created_at, startAt, endAt), sql`${orders.status} <> 'cancelled'`))
        .groupBy(sql`date(${orders.created_at})`)
        .orderBy(sql`date(${orders.created_at})`);
      dailyTrend = trendRows.map((r) => ({
        date: typeof r.d === 'string' ? r.d : new Date(r.d as any).toISOString().slice(0, 10),
        orderCount: Number(r.c ?? 0),
        revenue: Number(r.s ?? 0),
      }));
    }

    return {
      storeName,
      generatedBy,
      generatedAt: new Date(),
      type,
      date,
      startAt,
      endAt,
      orderCount,
      revenue,
      refundAmount,
      perTableAverage,
      categorySales,
      topDishes,
      dailyTrend,
    };
  }
}

function ReportRange(type: ReportType, date: string): { startAt: Date; endAt: Date } {
  if (type === 'DAILY') {
    const startAt = new Date(`${date}T00:00:00`);
    const endAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);
    return { startAt, endAt };
  }
  // MONTHLY: YYYY-MM
  const [yr, mo] = date.split('-').map(Number);
  const startAt = new Date(yr, mo - 1, 1, 0, 0, 0);
  const endAt = new Date(yr, mo, 1, 0, 0, 0);
  return { startAt, endAt };
}
