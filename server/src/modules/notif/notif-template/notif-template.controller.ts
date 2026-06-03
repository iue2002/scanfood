import { Controller, Get, Put, Delete, Post, Body, Query, Req, UseGuards, ForbiddenException, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard';
import { Audit } from '@/modules/merchant-ops/auth/decorators';
import { NotifTemplateCore } from './notif-template.core';
import { UpsertNotifTemplateDto, DeleteNotifTemplateDto, PreviewNotifTemplateDto } from './notif-template.dto';
import { TEMPLATE_VARIABLES, type TemplateEvent, type TemplateChannel } from './notif-template.types';

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
  async listAll(@Req() req: any) {
    assertAdmin(req);
    const data = await this.core.listAll();
    return { success: true, data };
  }

  @Get('variables')
  async getVariables(@Req() req: any) {
    assertAdmin(req);
    return { success: true, data: TEMPLATE_VARIABLES };
  }

  @Get('defaults')
  async getDefaults(@Req() req: any) {
    assertAdmin(req);
    const data = await this.core.getDefaults();
    return { success: true, data };
  }

  @Post('preview')
  @HttpCode(200)
  async preview(@Body() dto: PreviewNotifTemplateDto, @Req() req: any) {
    assertAdmin(req);
    const data = await this.core.preview(
      dto.event_type as TemplateEvent,
      dto.channel as TemplateChannel,
      dto.title_template !== undefined || dto.body_template !== undefined || dto.html_template !== undefined
        ? {
            event_type: dto.event_type as TemplateEvent,
            channel: dto.channel as TemplateChannel,
            title_template: dto.title_template,
            body_template: dto.body_template,
            html_template: dto.html_template,
          }
        : undefined,
      dto.allowed_variables,
    );
    return { success: true, data };
  }

  @Put()
  @Audit('NOTIF_TEMPLATE_UPDATE', { targetType: 'notification_template' })
  async upsert(@Body() dto: UpsertNotifTemplateDto, @Req() req: any) {
    assertAdmin(req);
    const data = await this.core.upsert(dto as any, req.user.userId);
    return { success: true, data };
  }

  @Delete()
  @Audit('NOTIF_TEMPLATE_UPDATE', { targetType: 'notification_template' })
  async remove(@Query() q: DeleteNotifTemplateDto, @Req() req: any) {
    assertAdmin(req);
    await this.core.delete(q.event_type as any, q.channel as any);
    return { success: true };
  }
}
