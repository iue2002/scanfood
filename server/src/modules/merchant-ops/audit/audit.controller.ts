import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Roles } from '../auth/decorators';
import { AuditCore } from './audit.core';
import { QueryAuditLogsDto } from './audit.dto';

/**
 * 审计日志查询接口
 * 仅 owner / manager 可见
 *
 * Validates: Requirements 8.1, 8.2, 8.3
 */
@Controller('merchant-ops/audit-logs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly core: AuditCore) {}

  @Get()
  @Roles('owner', 'manager')
  async query(@Query() dto: QueryAuditLogsDto) {
    const page = dto.page ?? 1;
    const pageSize: 20 | 50 | 100 = dto.pageSize ?? 20;

    const filter = {
      actor_user_id: dto.actor_user_id,
      action: dto.action,
      target_type: dto.target_type,
      target_id: dto.target_id,
      start_at: dto.start_at ? new Date(dto.start_at) : undefined,
      end_at: dto.end_at ? new Date(dto.end_at) : undefined,
    };

    return await this.core.query(filter, { page, pageSize });
  }
}
