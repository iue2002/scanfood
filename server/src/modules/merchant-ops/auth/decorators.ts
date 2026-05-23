import { SetMetadata } from '@nestjs/common';
import type { AuditAction, Role } from './rbac.types';

export const ROLES_KEY = 'merchant-ops:roles';
export const PERMISSIONS_KEY = 'merchant-ops:permissions';
export const AUDIT_KEY = 'merchant-ops:audit';

/**
 * 限定哪些角色可以访问某接口（按角色直接判定）
 * 用法：@Roles('owner', 'manager')
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * 限定哪个 AuditAction 对应的权限集才能访问
 * 优先使用 @Permissions —— 把权限放到矩阵里集中管理
 * 用法：@Permissions('EMPLOYEE_CREATE')
 */
export const Permissions = (action: AuditAction) => SetMetadata(PERMISSIONS_KEY, action);

/**
 * 标记接口为需要审计；AuditInterceptor 会在主事务提交后写入 audit_logs
 * 用法：@Audit('EMPLOYEE_CREATE')
 */
export interface AuditOpts {
  /** 自定义 target_type，默认从 url 推断 */
  targetType?: string;
}

export const Audit = (action: AuditAction, opts?: AuditOpts) =>
  SetMetadata(AUDIT_KEY, { action, opts });

export interface AuditMetadata {
  action: AuditAction;
  opts?: AuditOpts;
}
