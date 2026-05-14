import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { TablesService } from './tables.service';
import { CreateTableDto, UpdateTableDto } from './dto/table.dto';

@Controller('tables')
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  // 获取所有桌台
  @Get()
  async getTables() {
    console.log('[GET /api/tables]');
    return await this.tablesService.getTables();
  }

  // 获取单个桌台
  @Get(':id')
  async getTableById(@Param('id', ParseIntPipe) id: number) {
    console.log('[GET /api/tables/:id]', { id });
    return await this.tablesService.getTableById(id);
  }

  // 根据桌台编号获取桌台（扫码进入时使用）
  @Get('number/:tableNumber')
  async getTableByNumber(@Param('tableNumber') tableNumber: string) {
    console.log('[GET /api/tables/number/:tableNumber]', { tableNumber });
    return await this.tablesService.getTableByNumber(tableNumber);
  }

  // 创建桌台
  @Post()
  async createTable(@Body() dto: CreateTableDto) {
    console.log('[POST /api/tables]', dto);
    return await this.tablesService.createTable(dto);
  }

  // 更新桌台
  @Put(':id')
  async updateTable(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTableDto,
  ) {
    console.log('[PUT /api/tables/:id]', { id, dto });
    return await this.tablesService.updateTable(id, dto);
  }

  // 更新桌台状态
  @Post(':id/status')
  async updateTableStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: 'idle' | 'occupied' | 'settled',
  ) {
    console.log('[POST /api/tables/:id/status]', { id, status });
    return await this.tablesService.updateTableStatus(id, status);
  }

  // 删除桌台
  @Delete(':id')
  async deleteTable(@Param('id', ParseIntPipe) id: number) {
    console.log('[DELETE /api/tables/:id]', { id });
    return await this.tablesService.deleteTable(id);
  }

  // 生成二维码
  @Post(':id/qrcode')
  async generateQrCode(@Param('id', ParseIntPipe) id: number) {
    console.log('[POST /api/tables/:id/qrcode]', { id });
    return await this.tablesService.generateQrCode(id);
  }
}
