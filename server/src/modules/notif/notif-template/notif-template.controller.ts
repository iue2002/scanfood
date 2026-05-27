import { Controller, Get, Put, Delete, Body, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard';
import { NotifTemplateCore } from './notif-template.core';
import { UpsertNotifTemplateDto, DeleteNotifTemplateDto } from './notif-template.dto';
import { TEMPLATE_VARIABLES } from './notif-template.types';

const ADMIN_ROLES = new Set(['owner', 'manager', 'admin']);

function assertAdmin(req: any) {
  const role = req?.user?.role;
  if (!role || !ADMIN_ROLES.has(role)) {
    throw new ForbiddenException({ code: 'FORBIDDEN', msg: '仅店主/经理可管理模板' });
  }
}

@Controller('notif/templates')
@UseGuards(JwtAuthGuard)
export class NotifTemplateController {
  constructor(private readonly core: NotifTemplateCore) {}

  @Get()
  async listAll() {
    const data = await this.core.listAll();
    return { success: true, data };
  }

  @Get('variables')
  async getVariables() {
    return { success: true, data: TEMPLATE_VARIABLES };
  }

  @Put()
  async upsert(@Body() dto: UpsertNotifTemplateDto, @Req() req: any) {
    assertAdmin(req);
    const data = await this.core.upsert(dto as any, req.user.userId);
    return { success: true, data };
  }

  @Delete()
  async remove(@Query() q: DeleteNotifTemplateDto, @Req() req: any) {
    assertAdmin(req);
    await this.core.delete(q.event_type as any, q.channel as any);
    return { success: true };
  }
}
