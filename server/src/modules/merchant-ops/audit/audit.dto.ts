import { IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ALL_AUDIT_ACTIONS } from '../auth/rbac.types';
import type { AuditAction } from '../auth/rbac.types';

export class QueryAuditLogsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  actor_user_id?: number;

  @IsString()
  @IsOptional()
  @IsIn(ALL_AUDIT_ACTIONS as unknown as string[])
  action?: AuditAction;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  target_type?: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  target_id?: string;

  /** ISO 时间字符串：start_at <= created_at <= end_at；范围不超过 90 天 */
  @IsISO8601()
  @IsOptional()
  start_at?: string;

  @IsISO8601()
  @IsOptional()
  end_at?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsInt()
  @IsIn([20, 50, 100])
  @IsOptional()
  pageSize?: 20 | 50 | 100;
}
