import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StatisticsService } from './statistics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('statistics')
@UseGuards(JwtAuthGuard)
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  // 获取总览数据
  @Get('overview')
  async getOverview() {
    console.log('[GET /api/statistics/overview]');
    return await this.statisticsService.getOverview();
  }

  // 按菜品分类统计
  @Get('category')
  async getStatisticsByCategory(
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    console.log('[GET /api/statistics/category]', { startDate, endDate });
    return await this.statisticsService.getStatisticsByCategory(startDate, endDate);
  }

  // 按日统计
  @Get('day')
  async getStatisticsByDay(
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    console.log('[GET /api/statistics/day]', { startDate, endDate });
    return await this.statisticsService.getStatisticsByDay(startDate, endDate);
  }

  // 按月统计
  @Get('month')
  async getStatisticsByMonth(
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    console.log('[GET /api/statistics/month]', { startDate, endDate });
    return await this.statisticsService.getStatisticsByMonth(startDate, endDate);
  }

  // 菜品销售排行
  @Get('dish-ranking')
  async getDishRanking(
    @Query('limit') limit?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    console.log('[GET /api/statistics/dish-ranking]', { limit, startDate, endDate });
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return await this.statisticsService.getDishRanking(limitNum, startDate, endDate);
  }

  // 今日 24 小时分时营业额
  @Get('hourly-today')
  async getHourlyToday() {
    console.log('[GET /api/statistics/hourly-today]');
    return await this.statisticsService.getHourlyToday();
  }

  // 桌台排行
  @Get('table-ranking')
  async getTableRanking(
    @Query('limit') limit?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    console.log('[GET /api/statistics/table-ranking]', { limit, startDate, endDate });
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return await this.statisticsService.getTableRanking(limitNum, startDate, endDate);
  }

  // 区间核心 KPI（带环比）
  @Get('kpi')
  async getKpi(
    @Query('start_date') startDate: string,
    @Query('end_date') endDate: string,
  ) {
    console.log('[GET /api/statistics/kpi]', { startDate, endDate });
    return await this.statisticsService.getKpiSummary(startDate, endDate);
  }
}
