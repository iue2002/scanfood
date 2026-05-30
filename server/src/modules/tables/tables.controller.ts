import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, UseGuards } from '@nestjs/common';
import { TablesService } from './tables.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../merchant-ops/auth/permissions.guard';
import { Audit, Permissions } from '../merchant-ops/auth/decorators';
import { CreateTableDto, UpdateTableDto } from './dto/table.dto';

@Controller('tables')
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  // ---- 公开端点（扫码验证，无需登录） ----

  @Get('number/:tableNumber')
  async getTableByNumber(@Param('tableNumber') tableNumber: string) {
    return await this.tablesService.getTableByNumber(tableNumber);
  }

  @Get('validate/:tableNumber')
  async validateTableNumber(@Param('tableNumber') tableNumber: string) {
    return await this.tablesService.validateTableNumber(tableNumber);
  }

  // ---- 商家端点（RBAC 保护） ----

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('TABLE_READ')
  @Get()
  async getTables() {
    return await this.tablesService.getTables();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('TABLE_READ')
  @Get('board')
  async getTableBoard() {
    return await this.tablesService.getTableBoard();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('TABLE_READ')
  @Get(':id')
  async getTableById(@Param('id', ParseIntPipe) id: number) {
    return await this.tablesService.getTableById(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('TABLE_UPDATE')
  @Audit('TABLE_UPDATE')
  @Post()
  async createTable(@Body() dto: CreateTableDto) {
    return await this.tablesService.createTable(dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('TABLE_UPDATE')
  @Audit('TABLE_UPDATE')
  @Put(':id')
  async updateTable(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTableDto,
  ) {
    return await this.tablesService.updateTable(id, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('TABLE_UPDATE')
  @Audit('TABLE_UPDATE')
  @Post(':id/status')
  async updateTableStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: 'idle' | 'occupied' | 'settled',
  ) {
    return await this.tablesService.updateTableStatus(id, status);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('TABLE_UPDATE')
  @Audit('TABLE_UPDATE')
  @Delete(':id')
  async deleteTable(@Param('id', ParseIntPipe) id: number) {
    return await this.tablesService.deleteTable(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('TABLE_QRCODE_GENERATE')
  @Audit('TABLE_QRCODE_GENERATE')
  @Post(':id/qrcode')
  async generateQrCode(@Param('id', ParseIntPipe) id: number) {
    return await this.tablesService.generateQrCode(id);
  }
}
