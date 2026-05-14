import { Injectable, BadRequestException } from '@nestjs/common';
import { getSupabaseClient } from '@/storage/database/supabase-client';

@Injectable()
export class StatisticsService {
  private client = getSupabaseClient();

  // 按菜品分类统计
  async getStatisticsByCategory(startDate?: string, endDate?: string) {
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end = endDate || new Date().toISOString().slice(0, 10);

    const { data, error } = await this.client
      .from('orders')
      .select(`
        created_at,
        order_items(
          quantity,
          subtotal,
          dishes(
            name,
            category_id,
            dish_categories(name)
          )
        )
      `)
      .eq('status', 'settled')
      .gte('created_at', start)
      .lte('created_at', end + ' 23:59:59');

    if (error) throw new BadRequestException(`统计失败: ${error.message}`);

    // 按分类汇总
    const categoryMap: any = {};
    data?.forEach(order => {
      order.order_items?.forEach((item: any) => {
        const categoryName = item.dishes?.dish_categories?.name || '未分类';
        const categoryId = item.dishes?.category_id || 0;

        if (!categoryMap[categoryId]) {
          categoryMap[categoryId] = {
            category_id: categoryId,
            category_name: categoryName,
            quantity: 0,
            amount: 0,
          };
        }

        categoryMap[categoryId].quantity += item.quantity;
        categoryMap[categoryId].amount += parseFloat(item.subtotal);
      });
    });

    return Object.values(categoryMap).sort((a: any, b: any) => b.amount - a.amount);
  }

  // 按日统计
  async getStatisticsByDay(startDate?: string, endDate?: string) {
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end = endDate || new Date().toISOString().slice(0, 10);

    const { data, error } = await this.client
      .from('orders')
      .select('created_at, total_amount')
      .eq('status', 'settled')
      .gte('created_at', start)
      .lte('created_at', end + ' 23:59:59')
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(`统计失败: ${error.message}`);

    // 按日期汇总
    const dayMap: any = {};
    data?.forEach(order => {
      const date = order.created_at.slice(0, 10);
      if (!dayMap[date]) {
        dayMap[date] = {
          date,
          order_count: 0,
          total_amount: 0,
        };
      }
      dayMap[date].order_count += 1;
      dayMap[date].total_amount += parseFloat(order.total_amount);
    });

    return Object.values(dayMap);
  }

  // 按月统计
  async getStatisticsByMonth(startDate?: string, endDate?: string) {
    const start = startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 7);
    const end = endDate || new Date().toISOString().slice(0, 7);

    const { data, error } = await this.client
      .from('orders')
      .select('created_at, total_amount')
      .eq('status', 'settled')
      .gte('created_at', start + '-01')
      .lte('created_at', end + '-31')
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(`统计失败: ${error.message}`);

    // 按月份汇总
    const monthMap: any = {};
    data?.forEach(order => {
      const month = order.created_at.slice(0, 7);
      if (!monthMap[month]) {
        monthMap[month] = {
          month,
          order_count: 0,
          total_amount: 0,
        };
      }
      monthMap[month].order_count += 1;
      monthMap[month].total_amount += parseFloat(order.total_amount);
    });

    return Object.values(monthMap);
  }

  // 菜品销售排行
  async getDishRanking(limit: number = 10, startDate?: string, endDate?: string) {
    const start = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end = endDate || new Date().toISOString().slice(0, 10);

    const { data, error } = await this.client
      .from('orders')
      .select(`
        order_items(
          quantity,
          subtotal,
          dish_id,
          dish_name
        )
      `)
      .eq('status', 'settled')
      .gte('created_at', start)
      .lte('created_at', end + ' 23:59:59');

    if (error) throw new BadRequestException(`统计失败: ${error.message}`);

    // 按菜品汇总
    const dishMap: any = {};
    data?.forEach(order => {
      order.order_items?.forEach((item: any) => {
        if (!dishMap[item.dish_id]) {
          dishMap[item.dish_id] = {
            dish_id: item.dish_id,
            dish_name: item.dish_name,
            quantity: 0,
            amount: 0,
          };
        }
        dishMap[item.dish_id].quantity += item.quantity;
        dishMap[item.dish_id].amount += parseFloat(item.subtotal);
      });
    });

    // 按销量排序
    const ranking = Object.values(dishMap).sort((a: any, b: any) => b.quantity - a.quantity);
    return ranking.slice(0, limit);
  }

  // 获取总览数据
  async getOverview() {
    const today = new Date().toISOString().slice(0, 10);

    // 今日营业额
    const { data: todayOrders } = await this.client
      .from('orders')
      .select('total_amount')
      .eq('status', 'settled')
      .gte('created_at', today);

    const todayAmount = todayOrders?.reduce((sum, o) => sum + parseFloat(o.total_amount), 0) || 0;
    const todayCount = todayOrders?.length || 0;

    // 总订单数
    const { count: totalOrders } = await this.client
      .from('orders')
      .select('*', { count: 'exact', head: true });

    // 总营业额
    const { data: allOrders } = await this.client
      .from('orders')
      .select('total_amount')
      .eq('status', 'settled');

    const totalAmount = allOrders?.reduce((sum, o) => sum + parseFloat(o.total_amount), 0) || 0;

    return {
      today_amount: todayAmount.toFixed(2),
      today_count: todayCount,
      total_orders: totalOrders || 0,
      total_amount: totalAmount.toFixed(2),
    };
  }
}
