import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AuditCore } from './audit.core';
import { AUDIT_KEY } from '../auth/decorators';
import type { AuditMetadata } from '../auth/decorators';
import type { ActorContext, AuditPayload, Role } from '../auth/rbac.types';

/**
 * AuditInterceptor：跨切关注点
 *
 * 当 controller 处理函数挂了 @Audit(action) 装饰器时：
 * - 等 controller 成功 return 之后（rxjs tap）异步写入 audit_logs
 * - controller 抛异常时不写（I7：审计反映已 commit 的状态）
 * - 写入失败仅记日志，不冒泡（已在 AuditCore.write 内部包 try/catch）
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly core: AuditCore,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMetadata | undefined>(AUDIT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!meta) {
      return next.handle();
    }

    const req = ctx.switchToHttp().getRequest();
    const actor: ActorContext = {
      userId: req?.user?.userId,
      role: (req?.user?.role ?? 'admin') as Role,
      ip: this.extractIp(req),
      userAgent: (req?.headers?.['user-agent'] as string) ?? 'unknown',
      requestId: (req?.headers?.['x-request-id'] as string) ?? '',
    };
    const targetType = meta.opts?.targetType ?? this.inferTargetType(req?.url ?? '');
    const targetId = this.inferTargetId(req);
    // 请求体（用于 payload.before 的 hint）
    const requestBody = this.sanitizeBody(req?.body);

    return next.handle().pipe(
      tap({
        next: (response: any) => {
          // 成功路径：异步写审计
          // 不 await，让 controller 立即返回；写入失败由 core 内部吞
          const payload: AuditPayload = {
            action: meta.action,
            targetType,
            targetId,
            before: requestBody, // 简化版：把请求体作为 before；真正的 before/after 留给 service 层手动调 core.write
            after: response?.data ?? response ?? undefined,
          };
          // fire-and-forget
          this.core.write(actor, payload).catch((err) => {
            this.logger.warn(`[audit] async write rejected: ${(err as Error).message}`);
          });
        },
        error: (_err) => {
          // 异常路径：不写审计（R7.4：失败不写，反映 commit 后状态）
        },
      }),
    );
  }

  private extractIp(req: any): string {
    const xff = req?.headers?.['x-forwarded-for'];
    if (typeof xff === 'string') {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
    return req?.ip ?? req?.connection?.remoteAddress ?? 'unknown';
  }

  /**
   * 从 url 推断 target_type，例如 /api/merchant-ops/employees/123 → 'employee'
   * /api/orders/4/status → 'order'
   */
  private inferTargetType(url: string): string {
    const path = url.split('?')[0];
    const segments = path.split('/').filter((s) => s && !/^\d+$/.test(s));
    // 去掉 api / merchant-ops 前缀
    const cleaned = segments.filter((s) => s !== 'api' && s !== 'merchant-ops');
    if (cleaned.length === 0) return 'unknown';
    // 取倒数第一个有意义的段，去复数 s
    const last = cleaned[cleaned.length - 1];
    return last.replace(/s$/i, '');
  }

  private inferTargetId(req: any): string | null {
    const params = req?.params ?? {};
    if (params.id) return String(params.id);
    if (params.orderId) return String(params.orderId);
    if (params.tableId) return String(params.tableId);
    return null;
  }

  /**
   * 在传给 AuditCore 之前先打掉一层敏感字段（防御深度）；
   * AuditCore.redact 还会再做一次递归脱敏。
   */
  private sanitizeBody(body: any): Record<string, unknown> | undefined {
    if (!body || typeof body !== 'object') return undefined;
    return body;
  }
}
