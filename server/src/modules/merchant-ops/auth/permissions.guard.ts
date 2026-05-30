import { CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, PERMISSIONS_KEY } from './decorators';
import { isAllowed } from './permission-matrix';
import type { Role, AuditAction } from './rbac.types';

/**
 * PermissionsGuard：merchant-ops-center 的 RBAC 门卫
 *
 * 在 JwtAuthGuard 之后运行（顺序由 Controller 上 @UseGuards 决定）；
 * 读取 @Roles 或 @Permissions 元数据并对当前 request.user.role 做判定。
 *
 * - 没挂任何装饰器：放行（用于 GET /me 这类只需要登录的接口）
 * - 同时挂了 Roles + Permissions：两者都满足才放行
 * - 失败：抛 HTTP 403 + code: 'FORBIDDEN'
 *
 * Validates: Requirements 1.5, 1.6, 2.7
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const handler = ctx.getHandler();
    const cls = ctx.getClass();

    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [handler, cls]);
    const requiredAction = this.reflector.getAllAndOverride<AuditAction | undefined>(PERMISSIONS_KEY, [handler, cls]);

    if (!requiredRoles && !requiredAction) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest();
    const role: Role | undefined = req?.user?.role;

    if (!role) {
      // 全局 APP_GUARD 在方法级 JwtAuthGuard 之前执行；此时 req.user 可能尚未设置
      // 返回 true 让 JwtAuthGuard 处理认证；方法级 PermissionsGuard（如有）会再次检查
      if (!req.user) {
        return true;
      }
      // req.user 存在但 role 缺失：JWT payload 异常
      throw new UnauthorizedException({ code: 'TOKEN_MISSING', msg: '请先登录' });
    }

    // @Roles 校验
    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(role)) {
      // admin 兼容：admin 当作任意 staff role
      if (role !== 'admin') {
        throw new ForbiddenException({ code: 'FORBIDDEN', msg: '当前角色无权访问该接口' });
      }
    }

    // @Permissions 校验
    if (requiredAction && !isAllowed(role, requiredAction)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', msg: '当前角色无权执行该操作' });
    }

    return true;
  }
}
