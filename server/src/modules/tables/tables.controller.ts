import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, UseGuards } from '@nestjs/common';
import { TablesService } from './tables.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateTableDto, UpdateTableDto } from './dto/table.dto';

@Controller('tables')
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  // 获取所有桌台
  @UseGuards(JwtAuthGuard)
  @Get()
  async getTables() {
    return await this.tablesService.getTables();
  }

  // 获取桌台看板数据（含当前订单）
  @UseGuards(JwtAuthGuard)
  @Get('board')
  async getTableBoard() {
    return await this.tablesService.getTableBoard();
  }

  // 获取单个桌台
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getTableById(@Param('id', ParseIntPipe) id: number) {
    return await this.tablesService.getTableById(id);
  }

  // 根据桌台编号获取桌台（扫码进入时使用）
  @Get('number/:tableNumber')
  async getTableByNumber(@Param('tableNumber') tableNumber: string) {
    return await this.tablesService.getTableByNumber(tableNumber);
  }

  // 验证桌号是否有效（扫码时使用，无需登录）
  @Get('validate/:tableNumber')
  async validateTableNumber(@Param('tableNumber') tableNumber: string) {
    return await this.tablesService.validateTableNumber(tableNumber);
  }

  // 创建桌台
  @UseGuards(JwtAuthGuard)
  @Post()
  async createTable(@Body() dto: CreateTableDto) {
    return await this.tablesService.createTable(dto);
  }

  // 更新桌台
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async updateTable(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTableDto,
  ) {
    return await this.tablesService.updateTable(id, dto);
  }

  // 更新桌台状态
  @UseGuards(JwtAuthGuard)
  @Post(':id/status')
  async updateTableStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: 'idle' | 'occupied' | 'settled',
  ) {
    return await this.tablesService.updateTableStatus(id, status);
  }

  // 删除桌台
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deleteTable(@Param('id', ParseIntPipe) id: number) {
    return await this.tablesService.deleteTable(id);
  }

  // 生成二维码
  @UseGuards(JwtAuthGuard)
  @Post(':id/qrcode')
  async generateQrCode(@Param('id', ParseIntPipe) id: number) {
    return await this.tablesService.generateQrCode(id);
  }
}
