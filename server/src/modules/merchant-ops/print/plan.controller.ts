import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Audit, Permissions, Roles } from '../auth/decorators';
import { PrintCore } from './print.core';
import { PrintPlanCore } from './plan.core';
import { PrintPlanUpsertBodyDto, SelectivePrintDto } from './print.dto';
import type { PrintPlanUpsertDto } from './print.types';

/**
 * 打印方案 controller
 *
 * 路径前缀：/api/merchant-ops/print-plans
 *
 * 权限：
 *  - 列表/查询：owner / manager / admin
 *  - 增删改：owner / manager（PRINT_PLAN_UPDATE）
 *
 * 选购打印 / 重打 plan 选择：路径在 /merchant-ops/orders/:orderId/...
 */
@Controller('merchant-ops')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PrintPlanController {
  constructor(
    private readonly planCore: PrintPlanCore,
    private readonly printCore: PrintCore,
  ) {}

  // ============ Plan CRUD ============
  @Get('print-plans')
  @Roles('owner', 'manager', 'admin')
  async listPlans() {
    const data = await this.planCore.listPlans();
    return { data };
  }

  @Get('print-plans/:id')
  @Roles('owner', 'manager', 'admin')
  async getPlan(@Param('id', ParseIntPipe) id: number) {
    const data = await this.planCore.getPlan(id);
    return { data };
  }

  @Post('print-plans')
  @Permissions('PRINT_PLAN_UPDATE')
  @Audit('PRINT_PLAN_UPDATE', { targetType: 'print_plan' })
  async createPlan(@Body() dto: PrintPlanUpsertBodyDto) {
    const data = await this.planCore.createPlan(dto as PrintPlanUpsertDto);
    return { data };
  }

  @Put('print-plans/:id')
  @Permissions('PRINT_PLAN_UPDATE')
  @Audit('PRINT_PLAN_UPDATE', { targetType: 'print_plan' })
  async updatePlan(@Param('id', ParseIntPipe) id: number, @Body() dto: PrintPlanUpsertBodyDto) {
    const data = await this.planCore.updatePlan(id, dto as PrintPlanUpsertDto);
    return { data };
  }

  @Delete('print-plans/:id')
  @Permissions('PRINT_PLAN_UPDATE')
  @Audit('PRINT_PLAN_UPDATE', { targetType: 'print_plan' })
  @HttpCode(HttpStatus.OK)
  async deletePlan(@Param('id', ParseIntPipe) id: number) {
    await this.planCore.deletePlan(id);
    return { data: { id, deleted: true } };
  }

  // ============ 选购打印 ============
  /**
   * 商家手动勾选 items 打印（不走 plan）
   */
  @Post('orders/:orderId/selective-print')
  @Permissions('PRINTER_TEST')
  @Audit('PRINTER_TEST', { targetType: 'order' })
  @HttpCode(HttpStatus.OK)
  async selectivePrint(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: SelectivePrintDto,
  ) {
    const result = await this.printCore.selectivePrint({
      order_id: orderId,
      printer_id: dto.printer_id,
      template_id: dto.template_id ?? null,
      selected_item_ids: dto.selected_item_ids,
      label: dto.label,
    });
    return { data: result };
  }
}
