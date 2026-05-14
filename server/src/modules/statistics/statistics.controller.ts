import { Controller, Get, Query } from '@nestjs/common';
import { StatisticsService } from './statistics.service';

@Controller('statistics')
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
}
