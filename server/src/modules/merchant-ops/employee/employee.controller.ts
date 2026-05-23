import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Audit, Permissions, Roles } from '../auth/decorators';
import { EmployeeCore } from './employee.core';
import { ChangePasswordDto, CreateEmployeeDto, ListEmployeeQueryDto, UpdateEmployeeDto } from './employee.dto';
import type { ActorContext } from '../auth/rbac.types';

/**
 * 员工管理 controller
 * 路径前缀：/api/merchant-ops/employees
 *
 * 所有接口都需 JWT，且 owner 才能访问（PASSWORD_CHANGE 例外，员工自己改密）。
 */
@Controller('merchant-ops/employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmployeeController {
  constructor(private readonly core: EmployeeCore) {}

  private buildActor(req: any): ActorContext {
    return {
      userId: req?.user?.userId,
      role: req?.user?.role,
      ip: this.extractIp(req),
      userAgent: req?.headers?.['user-agent'] ?? 'unknown',
      requestId: req?.headers?.['x-request-id'] ?? '',
    };
  }

  private extractIp(req: any): string {
    const xff = req?.headers?.['x-forwarded-for'];
    if (typeof xff === 'string') {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
    return req?.ip ?? req?.connection?.remoteAddress ?? 'unknown';
  }

  @Get()
  @Roles('owner')
  async list(@Query() query: ListEmployeeQueryDto) {
    const page = query.page ?? 1;
    const pageSize: 10 | 20 | 50 = query.pageSize ?? 20;
    return await this.core.list(
      { role: query.role, status: query.status, username: query.username },
      { page, pageSize },
    );
  }

  @Post()
  @Permissions('EMPLOYEE_CREATE')
  @Audit('EMPLOYEE_CREATE')
  async create(@Body() dto: CreateEmployeeDto, @Req() req: any) {
    const actor = this.buildActor(req);
    const employee = await this.core.create(actor, dto);
    return { data: employee };
  }

  @Patch(':id')
  @Permissions('EMPLOYEE_UPDATE')
  @Audit('EMPLOYEE_UPDATE')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmployeeDto, @Req() req: any) {
    const actor = this.buildActor(req);
    const employee = await this.core.update(actor, id, dto);
    return { data: employee };
  }

  @Delete(':id')
  @Permissions('EMPLOYEE_DELETE')
  @Audit('EMPLOYEE_DELETE')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const actor = this.buildActor(req);
    await this.core.softDelete(actor, id);
    return { data: { id, deleted: true } };
  }

  @Post(':id/reset-password')
  @Permissions('PASSWORD_RESET')
  @Audit('PASSWORD_RESET')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async resetPassword(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const actor = this.buildActor(req);
    const result = await this.core.resetPassword(actor, id);
    return { data: result };
  }

  @Post('me/change-password')
  @Audit('PASSWORD_CHANGE')
  @HttpCode(HttpStatus.OK)
  async changeOwnPassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    const actor = this.buildActor(req);
    await this.core.changeOwnPassword(actor, dto.oldPassword, dto.newPassword);
    return { data: { changed: true } };
  }
}
