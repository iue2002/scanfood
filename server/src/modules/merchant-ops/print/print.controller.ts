import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Audit, Permissions, Roles } from '../auth/decorators';
import { PrintCore } from './print.core';
import { CreatePrinterDto, UpdatePrinterDto, CreateTemplateDto, UpdateTemplateDto } from './print.dto';
import type { TemplateField, PrintWidth } from './print.types';

/**
 * 打印 controller
 * 路径前缀：/api/merchant-ops/printers + /api/merchant-ops/print-templates
 *
 * 权限：
 *  - 打印机/模板增删改：owner / manager
 *  - 试打印 / 重打：owner / manager
 *  - 列表/查询：owner / manager（waiter/cashier 也能看自己关心的）
 */
@Controller('merchant-ops')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PrintController {
  constructor(private readonly core: PrintCore) {}

  // ============ 打印机 ============
  @Get('printers')
  @Roles('owner', 'manager', 'admin')
  async listPrinters() {
    const data = await this.core.listPrintersWithStatus();
    return { data };
  }

  @Post('printers')
  @Permissions('PRINTER_CONFIG_UPDATE')
  @Audit('PRINTER_CONFIG_UPDATE', { targetType: 'printer' })
  async createPrinter(@Body() dto: CreatePrinterDto) {
    const printer = await this.core.createPrinter(dto);
    return { data: PrintCore.toPublic(printer) };
  }

  @Patch('printers/:id')
  @Permissions('PRINTER_CONFIG_UPDATE')
  @Audit('PRINTER_CONFIG_UPDATE', { targetType: 'printer' })
  async updatePrinter(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePrinterDto) {
    const printer = await this.core.updatePrinter(id, dto as any);
    return { data: PrintCore.toPublic(printer) };
  }

  @Delete('printers/:id')
  @Permissions('PRINTER_CONFIG_UPDATE')
  @Audit('PRINTER_CONFIG_UPDATE', { targetType: 'printer' })
  @HttpCode(HttpStatus.OK)
  async removePrinter(@Param('id', ParseIntPipe) id: number) {
    await this.core.deletePrinter(id);
    return { data: { id, deleted: true } };
  }

  /** 切换 auto_print 单独审计 */
  @Patch('printers/:id/auto-print')
  @Permissions('PRINTER_AUTO_PRINT_TOGGLE')
  @Audit('PRINTER_AUTO_PRINT_TOGGLE', { targetType: 'printer' })
  @HttpCode(HttpStatus.OK)
  async toggleAutoPrint(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { auto_print?: boolean; auto_print_add_more?: boolean },
  ) {
    const printer = await this.core.updatePrinter(id, {
      auto_print: body.auto_print,
      auto_print_add_more: body.auto_print_add_more,
    } as any);
    return { data: PrintCore.toPublic(printer) };
  }

  @Post('printers/:id/test-print')
  @Permissions('PRINTER_TEST')
  @Audit('PRINTER_TEST', { targetType: 'printer' })
  @HttpCode(HttpStatus.OK)
  async testPrint(@Param('id', ParseIntPipe) id: number) {
    const result = await this.core.testPrint(id);
    return { data: result };
  }

  @Get('printers/:id/jobs')
  @Roles('owner', 'manager', 'admin')
  async listJobs(@Param('id', ParseIntPipe) id: number, @Query('limit') limit?: string) {
    const lim = limit ? Math.min(500, Math.max(1, parseInt(limit, 10))) : 100;
    const jobs = await this.core.listJobsByPrinter(id, lim);
    return { data: jobs };
  }

  /** 手动重打/补打：owner / manager 触发，对所有 enabled 打印机入队 REPRINT */
  @Post('orders/:orderId/reprint')
  @Permissions('PRINTER_TEST')
  @Audit('PRINTER_TEST', { targetType: 'order' })
  @HttpCode(HttpStatus.OK)
  async reprintOrder(@Param('orderId', ParseIntPipe) orderId: number) {
    const result = await this.core.reprintOrder(orderId);
    return { data: result };
  }

  // ============ 模板 ============
  @Get('print-templates')
  @Roles('owner', 'manager', 'admin')
  async listTemplates() {
    const data = await this.core.listTemplates();
    return { data };
  }

  @Get('print-templates/:id')
  @Roles('owner', 'manager', 'admin')
  async getTemplate(@Param('id', ParseIntPipe) id: number) {
    const data = await this.core.getTemplate(id);
    return { data };
  }

  @Post('print-templates')
  @Permissions('PRINT_TEMPLATE_UPDATE')
  @Audit('PRINT_TEMPLATE_UPDATE', { targetType: 'print_template' })
  async createTemplate(@Body() dto: CreateTemplateDto) {
    const data = await this.core.createTemplate(
      dto.name,
      dto.fields_json as TemplateField[],
      (dto.width ?? '80mm') as PrintWidth,
    );
    return { data };
  }

  @Put('print-templates/:id')
  @Permissions('PRINT_TEMPLATE_UPDATE')
  @Audit('PRINT_TEMPLATE_UPDATE', { targetType: 'print_template' })
  async updateTemplate(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTemplateDto) {
    const data = await this.core.updateTemplate(id, {
      name: dto.name,
      fields_json: dto.fields_json as TemplateField[] | undefined,
      width: dto.width as PrintWidth | undefined,
    });
    return { data };
  }

  @Post('print-templates/:id/preview')
  @Roles('owner', 'manager', 'admin')
  @HttpCode(HttpStatus.OK)
  async previewTemplate(@Param('id', ParseIntPipe) id: number) {
    const data = await this.core.previewTemplate(id);
    return { data };
  }
}
