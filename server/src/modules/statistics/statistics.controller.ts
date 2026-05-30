import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StatisticsService } from './statistics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../merchant-ops/auth/permissions.guard';
import { Permissions } from '../merchant-ops/auth/decorators';

@Controller('statistics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('STATISTICS_READ')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('overview')
  async getOverview() {
    return await this.statisticsService.getOverview();
  }

  @Get('category')
  async getStatisticsByCategory(
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    return await this.statisticsService.getStatisticsByCategory(startDate, endDate);
  }

  @Get('day')
  async getStatisticsByDay(
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    return await this.statisticsService.getStatisticsByDay(startDate, endDate);
  }

  @Get('month')
  async getStatisticsByMonth(
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    return await this.statisticsService.getStatisticsByMonth(startDate, endDate);
  }

  @Get('dish-ranking')
  async getDishRanking(
    @Query('limit') limit?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return await this.statisticsService.getDishRanking(limitNum, startDate, endDate);
  }

  @Get('hourly-today')
  async getHourlyToday() {
    return await this.statisticsService.getHourlyToday();
  }

  @Get('table-ranking')
  async getTableRanking(
    @Query('limit') limit?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return await this.statisticsService.getTableRanking(limitNum, startDate, endDate);
  }

  @Get('kpi')
  async getKpi(
    @Query('start_date') startDate: string,
    @Query('end_date') endDate: string,
  ) {
    return await this.statisticsService.getKpiSummary(startDate, endDate);
  }
}
