import { Injectable, BadRequestException } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { orders, order_items, dishes, dish_categories } from '@/storage/database/shared/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';

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

    const todayOrders = await db.select().from(orders)
      .where(and(eq(orders.status, 'settled'), gte(orders.created_at, todayStart)));

    const todayAmount = todayOrders.reduce((sum, o) => sum + parseFloat(o.total_amount as any), 0);
    const todayCount = todayOrders.length;

    const totalResult = await db.select({ count: sql<number>`count(*)` }).from(orders);
    const totalOrders = totalResult[0]?.count || 0;

    const allSettled = await db.select().from(orders).where(eq(orders.status, 'settled'));
    const totalAmount = allSettled.reduce((sum, o) => sum + parseFloat(o.total_amount as any), 0);

    return {
      today_amount: todayAmount.toFixed(2),
      today_count: todayCount,
      total_orders: totalOrders,
      total_amount: totalAmount.toFixed(2),
    };
  }
}
