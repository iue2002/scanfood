/**
 * 请求结构化日志拦截器（R20.3）
 *
 * 仅对 /api/merchant-ops/* 路由生效，避免污染既有业务的日志格式。
 * 输出字段：requestId / actorUserId / route / method / statusCode / durationMs
 */
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { randomUUID } from 'crypto';

@Injectable()
export class MerchantOpsRequestLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('MopHttp');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const url: string = req?.url ?? '';
    // 只记录 merchant-ops 子路由（避免污染主业务日志）
    if (!url.startsWith('/api/merchant-ops/')) {
      return next.handle();
    }
    const requestId = (req?.headers?.['x-request-id'] as string) || randomUUID();
    try { res.setHeader('X-Request-Id', requestId); } catch { /* ignore */ }
    const start = Date.now();
    const meta = {
      requestId,
      method: req?.method,
      route: url.split('?')[0],
      actorUserId: req?.user?.userId ?? null,
    };

    return next.handle().pipe(
      tap({
        next: () => {
          const dur = Date.now() - start;
          const status = res?.statusCode;
          this.logger.log(`${meta.method} ${meta.route} ${status} ${dur}ms requestId=${requestId} actorUserId=${meta.actorUserId}`);
        },
        error: (err: any) => {
          const dur = Date.now() - start;
          const status = err?.status || res?.statusCode || 500;
          this.logger.warn(`${meta.method} ${meta.route} ${status} ${dur}ms requestId=${requestId} actorUserId=${meta.actorUserId} error=${err?.message ?? err}`);
        },
      }),
    );
  }
}
