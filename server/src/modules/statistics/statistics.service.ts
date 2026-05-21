import { Injectable, BadRequestException } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { orders, order_items, dishes, dish_categories, refunds } from '@/storage/database/shared/schema';
import { eq, and, gte, lte, sql, desc, ne, inArray } from 'drizzle-orm';

@Injectable()
export class StatisticsService {
  async getStatisticsByCategory(startDate?: string, endDate?: string) {
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end = endDate || new Date().toISOString().slice(0, 10);

    const orderList = await db.select().from(orders)
      .where(and(
        eq(orders.status, 'settled'),
        gte(orders.created_at, new Date(start)),
        lte(orders.created_at, new Date(end + ' 23:59:59'))
      ));

    const items = await db.select().from(order_items);
    const dishList = await db.select().from(dishes);
    const categoryList = await db.select().from(dish_categories);

    const categoryMap: any = {};
    orderList.forEach(order => {
      const orderItems = items.filter(i => i.order_id === order.id);
      orderItems.forEach(item => {
        const dish = dishList.find(d => d.id === item.dish_id);
        const category = categoryList.find(c => c.id === dish?.category_id);
        const categoryName = category?.name || '未分类';
        const categoryId = category?.id || 0;

        if (!categoryMap[categoryId]) {
          categoryMap[categoryId] = { category_id: categoryId, category_name: categoryName, quantity: 0, amount: 0 };
        }
        categoryMap[categoryId].quantity += item.quantity;
        categoryMap[categoryId].amount += parseFloat(item.subtotal as any);
      });
    });

    return Object.values(categoryMap).sort((a: any, b: any) => b.amount - a.amount);
  }

  async getStatisticsByDay(startDate?: string, endDate?: string) {
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end = endDate || new Date().toISOString().slice(0, 10);

    const orderList = await db.select().from(orders)
      .where(and(
        eq(orders.status, 'settled'),
        gte(orders.created_at, new Date(start)),
        lte(orders.created_at, new Date(end + ' 23:59:59'))
      ))
      .orderBy(orders.created_at);

    const dayMap: any = {};
    orderList.forEach(order => {
      const date = (order.created_at as any).toISOString().slice(0, 10);
      if (!dayMap[date]) {
        dayMap[date] = { date, order_count: 0, total_amount: 0 };
      }
      dayMap[date].order_count += 1;
      dayMap[date].total_amount += parseFloat(order.total_amount as any);
    });

    return Object.values(dayMap);
  }

  async getStatisticsByMonth(startDate?: string, endDate?: string) {
    const start = startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 7);
    const end = endDate || new Date().toISOString().slice(0, 7);

    const orderList = await db.select().from(orders)
      .where(and(
        eq(orders.status, 'settled'),
        gte(orders.created_at, new Date(start + '-01')),
        lte(orders.created_at, new Date(end + '-31'))
      ))
      .orderBy(orders.created_at);

    const monthMap: any = {};
    orderList.forEach(order => {
      const month = (order.created_at as any).toISOString().slice(0, 7);
      if (!monthMap[month]) {
        monthMap[month] = { month, order_count: 0, total_amount: 0 };
      }
      monthMap[month].order_count += 1;
      monthMap[month].total_amount += parseFloat(order.total_amount as any);
    });

    return Object.values(monthMap);
  }

  async getDishRanking(limit: number = 10, startDate?: string, endDate?: string) {
    const start = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end = endDate || new Date().toISOString().slice(0, 10);

    const orderList = await db.select().from(orders)
      .where(and(
        eq(orders.status, 'settled'),
        gte(orders.created_at, new Date(start)),
        lte(orders.created_at, new Date(end + ' 23:59:59'))
      ));

    const items = await db.select().from(order_items);

    const dishMap: any = {};
    orderList.forEach(order => {
      const orderItems = items.filter(i => i.order_id === order.id);
      orderItems.forEach(item => {
        if (!dishMap[item.dish_id]) {
          dishMap[item.dish_id] = { dish_id: item.dish_id, dish_name: item.dish_name, quantity: 0, amount: 0 };
        }
        dishMap[item.dish_id].quantity += item.quantity;
        dishMap[item.dish_id].amount += parseFloat(item.subtotal as any);
      });
    });

    const ranking = Object.values(dishMap).sort((a: any, b: any) => b.quantity - a.quantity);
    return ranking.slice(0, limit);
  }

  async getOverview() {
    const today = new Date().toISOString().slice(0, 10);
    const todayStart = new Date(today);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const weekStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000); // 含今日共 7 天
    const monthStart = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000); // 含今日共 30 天

    // 今日已结账订单
    const todayOrders = await db.select().from(orders)
      .where(and(eq(orders.status, 'settled'), gte(orders.created_at, todayStart)));
    const todayAmount = todayOrders.reduce((sum, o) => sum + parseFloat(o.total_amount as any), 0);
    const todayCount = todayOrders.length;

    // 昨日已结账订单（环比基线）
    const yesterdayOrders = await db.select().from(orders)
      .where(and(
        eq(orders.status, 'settled'),
        gte(orders.created_at, yesterdayStart),
        lte(orders.created_at, todayStart),
      ));
    const yesterdayAmount = yesterdayOrders.reduce((sum, o) => sum + parseFloat(o.total_amount as any), 0);
    const yesterdayCount = yesterdayOrders.length;

    // 7 日 / 30 日已结账订单
    const weekOrders = await db.select().from(orders)
      .where(and(eq(orders.status, 'settled'), gte(orders.created_at, weekStart)));
    const weekAmount = weekOrders.reduce((sum, o) => sum + parseFloat(o.total_amount as any), 0);

    const monthOrders = await db.select().from(orders)
      .where(and(eq(orders.status, 'settled'), gte(orders.created_at, monthStart)));
    const monthAmount = monthOrders.reduce((sum, o) => sum + parseFloat(o.total_amount as any), 0);

    // 总订单数（所有状态）
    const totalResult = await db.select({ count: sql<number>`count(*)` }).from(orders);
    const totalOrders = totalResult[0]?.count || 0;

    // 历史总营业额（已结账）
    const allSettled = await db.select().from(orders).where(eq(orders.status, 'settled'));
    const totalAmount = allSettled.reduce((sum, o) => sum + parseFloat(o.total_amount as any), 0);

    // 当前实时状态分布（不含 draft）
    const inProgress = await db.select().from(orders).where(ne(orders.status, 'draft'));
    const statusDist: Record<string, number> = {
      submitted: 0, printed: 0, settled: 0, cancelled: 0, refunded: 0,
    };
    inProgress.forEach(o => {
      const s = (o.status as string) || 'submitted';
      if (statusDist[s] !== undefined) statusDist[s] += 1;
    });

    // 客单价（今日 / 7 日）
    const avgToday = todayCount > 0 ? todayAmount / todayCount : 0;
    const avgWeek = weekOrders.length > 0 ? weekAmount / weekOrders.length : 0;

    // 退款总额（pending + approved，全时段）
    const refundList = await db.select().from(refunds);
    const pendingRefund = refundList.filter(r => r.status === 'pending').length;
    const approvedRefundAmount = refundList
      .filter(r => r.status === 'approved')
      .reduce((sum, r) => sum + parseFloat(r.amount as any), 0);

    const pct = (cur: number, prev: number) => {
      if (!prev) return cur > 0 ? 100 : 0;
      return ((cur - prev) / prev) * 100;
    };

    return {
      today_amount: todayAmount.toFixed(2),
      today_count: todayCount,
      total_orders: totalOrders,
      total_amount: totalAmount.toFixed(2),
      // 环比与扩展指标
      yesterday_amount: yesterdayAmount.toFixed(2),
      yesterday_count: yesterdayCount,
      amount_change_pct: Number(pct(todayAmount, yesterdayAmount).toFixed(1)),
      count_change_pct: Number(pct(todayCount, yesterdayCount).toFixed(1)),
      week_amount: weekAmount.toFixed(2),
      week_count: weekOrders.length,
      month_amount: monthAmount.toFixed(2),
      month_count: monthOrders.length,
      avg_today: avgToday.toFixed(2),
      avg_week: avgWeek.toFixed(2),
      status_distribution: statusDist,
      pending_refund: pendingRefund,
      approved_refund_amount: approvedRefundAmount.toFixed(2),
    };
  }

  // 今日 24 小时分时营业额（识别就餐高峰）
  async getHourlyToday() {
    const today = new Date().toISOString().slice(0, 10);
    const todayStart = new Date(today);
    const todayOrders = await db.select().from(orders)
      .where(and(eq(orders.status, 'settled'), gte(orders.created_at, todayStart)));

    const hourly: Array<{ hour: string; amount: number; count: number }> = Array.from({ length: 24 }, (_, h) => ({
      hour: `${String(h).padStart(2, '0')}:00`,
      amount: 0,
      count: 0,
    }));
    todayOrders.forEach(order => {
      const d = order.created_at as any as Date;
      const h = d.getHours();
      hourly[h].amount += parseFloat(order.total_amount as any);
      hourly[h].count += 1;
    });
    return hourly.map(h => ({ ...h, amount: Number(h.amount.toFixed(2)) }));
  }

  // 桌台 TOP（按出单数 / 营业额排序）
  async getTableRanking(limit: number = 10, startDate?: string, endDate?: string) {
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end = endDate || new Date().toISOString().slice(0, 10);
    const orderList = await db.select().from(orders)
      .where(and(
        eq(orders.status, 'settled'),
        gte(orders.created_at, new Date(start)),
        lte(orders.created_at, new Date(end + ' 23:59:59'))
      ));
    const tableMap: Record<string, { table_id: number; order_count: number; total_amount: number }> = {};
    orderList.forEach(o => {
      const tid = o.table_id as number;
      if (!tableMap[tid]) {
        tableMap[tid] = { table_id: tid, order_count: 0, total_amount: 0 };
      }
      tableMap[tid].order_count += 1;
      tableMap[tid].total_amount += parseFloat(o.total_amount as any);
    });
    return Object.values(tableMap)
      .sort((a, b) => b.total_amount - a.total_amount)
      .slice(0, limit)
      .map(t => ({ ...t, total_amount: Number(t.total_amount.toFixed(2)) }));
  }

  // 区间核心 KPI（带环比）
  async getKpiSummary(startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate + ' 23:59:59');
    const span = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - span);

    const fetch = async (s: Date, e: Date) => {
      const list = await db.select().from(orders).where(and(
        eq(orders.status, 'settled'),
        gte(orders.created_at, s),
        lte(orders.created_at, e),
      ));
      const amount = list.reduce((sum, o) => sum + parseFloat(o.total_amount as any), 0);
      const count = list.length;
      const avg = count > 0 ? amount / count : 0;
      return { amount, count, avg };
    };

    const cur = await fetch(start, end);
    const prev = await fetch(prevStart, prevEnd);

    // 区间退款
    const refundList = await db.select().from(refunds).where(and(
      eq(refunds.status, 'approved'),
      gte(refunds.created_at, start),
      lte(refunds.created_at, end),
    ));
    const refundAmount = refundList.reduce((sum, r) => sum + parseFloat(r.amount as any), 0);

    const pct = (a: number, b: number) => {
      if (!b) return a > 0 ? 100 : 0;
      return Number(((a - b) / b * 100).toFixed(1));
    };

    return {
      amount: Number(cur.amount.toFixed(2)),
      count: cur.count,
      avg: Number(cur.avg.toFixed(2)),
      refund_amount: Number(refundAmount.toFixed(2)),
      amount_pct: pct(cur.amount, prev.amount),
      count_pct: pct(cur.count, prev.count),
      avg_pct: pct(cur.avg, prev.avg),
    };
  }
}
