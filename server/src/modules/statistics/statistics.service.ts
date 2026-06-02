import { Injectable } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { orders, order_items, dishes, dish_categories, refunds } from '@/storage/database/shared/schema';
import { eq, and, gte, lte, sql, between, ne } from 'drizzle-orm';

/**
 * StatisticsService（P1-2 重构）
 *
 * 改造目标：
 *  - 全表拉取到 Node 内存做 filter/reduce → 下沉为 SQL 聚合（GROUP BY / SUM / COUNT），
 *    数据量增长后内存与查询都可控（参照 mop readonly-orders.drizzle 的聚合范式）。
 *  - 金额聚合用 SQL 的 DECIMAL SUM（精确），避免对大数组逐项 parseFloat + reduce 累积浮点误差。
 *  - 日期边界用「服务器本地时区」的 00:00:00 / 23:59:59，修正原先 toISOString()(UTC) 跨时区错位。
 *  - 修正按月统计 `new Date(end + '-31')` 的非法月末问题。
 */
@Injectable()
export class StatisticsService {
  // ============================================================
  // 时间/数值工具
  // ============================================================

  /** 解析 YYYY-MM-DD 为「本地时区」当日 00:00:00；非法/缺省回退到 fallback */
  private startOfDay(dateStr: string | undefined, fallback: Date): Date {
    const base = dateStr ? this.parseLocalDate(dateStr) : null;
    const d = base ?? fallback;
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** 解析 YYYY-MM-DD 为「本地时区」当日 23:59:59.999；非法/缺省回退到 fallback */
  private endOfDay(dateStr: string | undefined, fallback: Date): Date {
    const base = dateStr ? this.parseLocalDate(dateStr) : null;
    const d = base ?? fallback;
    d.setHours(23, 59, 59, 999);
    return d;
  }

  /** 把 YYYY-MM-DD 当作本地时区日期解析（避免 new Date('2026-05-01') 被当 UTC） */
  private parseLocalDate(dateStr: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
    if (!m) {
      const fallback = new Date(dateStr);
      return Number.isNaN(fallback.getTime()) ? null : fallback;
    }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  private daysAgo(n: number): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d;
  }

  /** decimal 字符串/数值 → 两位小数 number（用于把 SQL SUM 结果安全转出） */
  private round2(v: unknown): number {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  private toInt(v: unknown): number {
    const n = typeof v === 'number' ? v : parseInt(String(v ?? 0), 10);
    return Number.isFinite(n) ? n : 0;
  }

  // ============================================================
  // 分类销售统计
  // ============================================================

  async getStatisticsByCategory(startDate?: string, endDate?: string) {
    const start = this.startOfDay(startDate, this.daysAgo(30));
    const end = this.endOfDay(endDate, new Date());

    const rows = await db
      .select({
        category_id: sql<number>`coalesce(${dish_categories.id}, 0)`,
        category_name: sql<string>`coalesce(${dish_categories.name}, '未分类')`,
        quantity: sql<number>`sum(${order_items.quantity})`,
        amount: sql<number>`coalesce(sum(${order_items.subtotal}), 0)`,
      })
      .from(order_items)
      .innerJoin(orders, eq(order_items.order_id, orders.id))
      .leftJoin(dishes, eq(order_items.dish_id, dishes.id))
      .leftJoin(dish_categories, eq(dishes.category_id, dish_categories.id))
      .where(and(eq(orders.status, 'settled'), between(orders.created_at, start, end)))
      .groupBy(sql`coalesce(${dish_categories.id}, 0)`, sql`coalesce(${dish_categories.name}, '未分类')`)
      .orderBy(sql`coalesce(sum(${order_items.subtotal}), 0) desc`);

    return rows.map((r) => ({
      category_id: this.toInt(r.category_id),
      category_name: r.category_name,
      quantity: this.toInt(r.quantity),
      amount: this.round2(r.amount),
    }));
  }

  // ============================================================
  // 按日统计
  // ============================================================

  async getStatisticsByDay(startDate?: string, endDate?: string) {
    const start = this.startOfDay(startDate, this.daysAgo(30));
    const end = this.endOfDay(endDate, new Date());

    const rows = await db
      .select({
        date: sql<string>`date(${orders.created_at})`,
        order_count: sql<number>`count(*)`,
        total_amount: sql<number>`coalesce(sum(${orders.total_amount}), 0)`,
      })
      .from(orders)
      .where(and(eq(orders.status, 'settled'), between(orders.created_at, start, end)))
      .groupBy(sql`date(${orders.created_at})`)
      .orderBy(sql`date(${orders.created_at})`);

    return rows.map((r) => ({
      date: String(r.date),
      order_count: this.toInt(r.order_count),
      total_amount: this.round2(r.total_amount),
    }));
  }

  // ============================================================
  // 按月统计
  // ============================================================

  async getStatisticsByMonth(startDate?: string, endDate?: string) {
    // 默认近 12 个月
    const start = startDate
      ? this.startOfDay(`${startDate.slice(0, 7)}-01`, this.daysAgo(365))
      : this.firstDayOfMonthsAgo(11);
    // 结束：endDate 所在月的月末；缺省取今天
    const end = endDate ? this.endOfMonth(endDate) : this.endOfDay(undefined, new Date());

    const rows = await db
      .select({
        month: sql<string>`date_format(${orders.created_at}, '%Y-%m')`,
        order_count: sql<number>`count(*)`,
        total_amount: sql<number>`coalesce(sum(${orders.total_amount}), 0)`,
      })
      .from(orders)
      .where(and(eq(orders.status, 'settled'), between(orders.created_at, start, end)))
      .groupBy(sql`date_format(${orders.created_at}, '%Y-%m')`)
      .orderBy(sql`date_format(${orders.created_at}, '%Y-%m')`);

    return rows.map((r) => ({
      month: String(r.month),
      order_count: this.toInt(r.order_count),
      total_amount: this.round2(r.total_amount),
    }));
  }

  /** N 个月前那个月的 1 号 00:00:00（本地时区） */
  private firstDayOfMonthsAgo(n: number): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() - n, 1, 0, 0, 0, 0);
  }

  /** 给定 YYYY-MM(-DD) 返回该月最后一刻（本地时区），正确处理 2 月/小月 */
  private endOfMonth(dateStr: string): Date {
    const m = /^(\d{4})-(\d{2})/.exec(dateStr);
    const now = new Date();
    const year = m ? Number(m[1]) : now.getFullYear();
    const month = m ? Number(m[2]) - 1 : now.getMonth();
    // 下个月第 0 天 = 当月最后一天
    return new Date(year, month + 1, 0, 23, 59, 59, 999);
  }

  // ============================================================
  // 菜品销量排行
  // ============================================================

  async getDishRanking(limit: number = 10, startDate?: string, endDate?: string) {
    const start = this.startOfDay(startDate, this.daysAgo(7));
    const end = this.endOfDay(endDate, new Date());
    const safeLimit = Math.min(100, Math.max(1, this.toInt(limit) || 10));

    const rows = await db
      .select({
        dish_id: order_items.dish_id,
        dish_name: order_items.dish_name,
        quantity: sql<number>`sum(${order_items.quantity})`,
        amount: sql<number>`coalesce(sum(${order_items.subtotal}), 0)`,
      })
      .from(order_items)
      .innerJoin(orders, eq(order_items.order_id, orders.id))
      .where(and(eq(orders.status, 'settled'), between(orders.created_at, start, end)))
      .groupBy(order_items.dish_id, order_items.dish_name)
      .orderBy(sql`sum(${order_items.quantity}) desc`)
      .limit(safeLimit);

    return rows.map((r) => ({
      dish_id: this.toInt(r.dish_id),
      dish_name: r.dish_name,
      quantity: this.toInt(r.quantity),
      amount: this.round2(r.amount),
    }));
  }

  // ============================================================
  // 经营总览
  // ============================================================

  async getOverview() {
    const todayStart = this.daysAgo(0);
    const yesterdayStart = this.daysAgo(1);
    const weekStart = this.daysAgo(6); // 含今日共 7 天
    const monthStart = this.daysAgo(29); // 含今日共 30 天

    // 单条 SQL 聚合一段区间的 settled 营业额 + 单数
    const settledAgg = async (start: Date, end?: Date) => {
      const conds = [eq(orders.status, 'settled'), gte(orders.created_at, start)];
      if (end) conds.push(lte(orders.created_at, end));
      const r = await db
        .select({
          amount: sql<number>`coalesce(sum(${orders.total_amount}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(orders)
        .where(and(...conds));
      return { amount: this.round2(r[0]?.amount), count: this.toInt(r[0]?.count) };
    };

    const [today, yesterday, week, month] = await Promise.all([
      settledAgg(todayStart),
      settledAgg(yesterdayStart, todayStart),
      settledAgg(weekStart),
      settledAgg(monthStart),
    ]);

    // 总订单数（所有状态） + 历史总营业额（settled）
    const [totalRow, allSettledRow] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(orders),
      db
        .select({ amount: sql<number>`coalesce(sum(${orders.total_amount}), 0)` })
        .from(orders)
        .where(eq(orders.status, 'settled')),
    ]);

    // 当前实时状态分布（不含 draft），SQL GROUP BY
    const distRows = await db
      .select({ status: orders.status, count: sql<number>`count(*)` })
      .from(orders)
      .where(ne(orders.status, 'draft'))
      .groupBy(orders.status);
    const statusDist: Record<string, number> = {
      submitted: 0, printed: 0, settled: 0, cancelled: 0, refunded: 0,
    };
    for (const row of distRows) {
      const s = (row.status as string) || 'submitted';
      if (statusDist[s] !== undefined) statusDist[s] = this.toInt(row.count);
    }

    // 退款：pending 数 + approved 总额
    const [pendingRow, approvedRow] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(refunds).where(eq(refunds.status, 'pending')),
      db
        .select({ amount: sql<number>`coalesce(sum(${refunds.amount}), 0)` })
        .from(refunds)
        .where(eq(refunds.status, 'approved')),
    ]);

    const pct = (cur: number, prev: number) => {
      if (!prev) return cur > 0 ? 100 : 0;
      return ((cur - prev) / prev) * 100;
    };

    const avgToday = today.count > 0 ? today.amount / today.count : 0;
    const avgWeek = week.count > 0 ? week.amount / week.count : 0;

    return {
      today_amount: today.amount.toFixed(2),
      today_count: today.count,
      total_orders: this.toInt(totalRow[0]?.count),
      total_amount: this.round2(allSettledRow[0]?.amount).toFixed(2),
      yesterday_amount: yesterday.amount.toFixed(2),
      yesterday_count: yesterday.count,
      amount_change_pct: Number(pct(today.amount, yesterday.amount).toFixed(1)),
      count_change_pct: Number(pct(today.count, yesterday.count).toFixed(1)),
      week_amount: week.amount.toFixed(2),
      week_count: week.count,
      month_amount: month.amount.toFixed(2),
      month_count: month.count,
      avg_today: avgToday.toFixed(2),
      avg_week: avgWeek.toFixed(2),
      status_distribution: statusDist,
      pending_refund: this.toInt(pendingRow[0]?.count),
      approved_refund_amount: this.round2(approvedRow[0]?.amount).toFixed(2),
    };
  }

  // ============================================================
  // 今日 24 小时分时营业额
  // ============================================================

  async getHourlyToday() {
    const todayStart = this.daysAgo(0);
    const todayEnd = this.endOfDay(undefined, new Date());

    const rows = await db
      .select({
        hour: sql<number>`hour(${orders.created_at})`,
        amount: sql<number>`coalesce(sum(${orders.total_amount}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(orders)
      .where(and(eq(orders.status, 'settled'), between(orders.created_at, todayStart, todayEnd)))
      .groupBy(sql`hour(${orders.created_at})`);

    const byHour = new Map<number, { amount: number; count: number }>();
    for (const r of rows) {
      byHour.set(this.toInt(r.hour), { amount: this.round2(r.amount), count: this.toInt(r.count) });
    }

    return Array.from({ length: 24 }, (_, h) => {
      const e = byHour.get(h);
      return {
        hour: `${String(h).padStart(2, '0')}:00`,
        amount: e ? e.amount : 0,
        count: e ? e.count : 0,
      };
    });
  }

  // ============================================================
  // 桌台 TOP
  // ============================================================

  async getTableRanking(limit: number = 10, startDate?: string, endDate?: string) {
    const start = this.startOfDay(startDate, this.daysAgo(30));
    const end = this.endOfDay(endDate, new Date());
    const safeLimit = Math.min(100, Math.max(1, this.toInt(limit) || 10));

    const rows = await db
      .select({
        table_id: orders.table_id,
        order_count: sql<number>`count(*)`,
        total_amount: sql<number>`coalesce(sum(${orders.total_amount}), 0)`,
      })
      .from(orders)
      .where(and(eq(orders.status, 'settled'), between(orders.created_at, start, end)))
      .groupBy(orders.table_id)
      .orderBy(sql`coalesce(sum(${orders.total_amount}), 0) desc`)
      .limit(safeLimit);

    return rows.map((r) => ({
      table_id: this.toInt(r.table_id),
      order_count: this.toInt(r.order_count),
      total_amount: this.round2(r.total_amount),
    }));
  }

  // ============================================================
  // 区间核心 KPI（带环比）
  // ============================================================

  async getKpiSummary(startDate: string, endDate: string) {
    const start = this.startOfDay(startDate, this.daysAgo(30));
    const end = this.endOfDay(endDate, new Date());
    const span = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - span);

    const fetchAgg = async (s: Date, e: Date) => {
      const r = await db
        .select({
          amount: sql<number>`coalesce(sum(${orders.total_amount}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(orders)
        .where(and(eq(orders.status, 'settled'), between(orders.created_at, s, e)));
      const amount = this.round2(r[0]?.amount);
      const count = this.toInt(r[0]?.count);
      const avg = count > 0 ? amount / count : 0;
      return { amount, count, avg };
    };

    const [cur, prev, refundRow] = await Promise.all([
      fetchAgg(start, end),
      fetchAgg(prevStart, prevEnd),
      db
        .select({ amount: sql<number>`coalesce(sum(${refunds.amount}), 0)` })
        .from(refunds)
        .where(and(eq(refunds.status, 'approved'), between(refunds.created_at, start, end))),
    ]);

    const refundAmount = this.round2(refundRow[0]?.amount);

    const pct = (a: number, b: number) => {
      if (!b) return a > 0 ? 100 : 0;
      return Number((((a - b) / b) * 100).toFixed(1));
    };

    return {
      amount: this.round2(cur.amount),
      count: cur.count,
      avg: this.round2(cur.avg),
      refund_amount: refundAmount,
      amount_pct: pct(cur.amount, prev.amount),
      count_pct: pct(cur.count, prev.count),
      avg_pct: pct(cur.avg, prev.avg),
    };
  }
}
