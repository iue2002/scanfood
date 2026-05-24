/**
 * 用户级速率限制 Guard（R20.6）
 *
 * 用法：
 *   @UseGuards(JwtAuthGuard, ExportRateLimitGuard)
 *   @Post('orders')
 *
 * 限制配置：
 *   导出 orders / reports 单用户每分钟 ≤ 5 次
 *
 * 拒绝时返回 HTTP 429 + { code: 'RATE_LIMITED', msg, retryAfterMs }
 */
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { SlidingWindowRateLimiter } from './rate-limiter';

const EXPORT_LIMIT = 5;
const EXPORT_WINDOW_MS = 60 * 1000;

// 进程内单例：每个用户独立桶
export const exportLimiter = new SlidingWindowRateLimiter({ limit: EXPORT_LIMIT, windowMs: EXPORT_WINDOW_MS });

@Injectable()
export class ExportRateLimitGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const userId = req?.user?.userId;
    const key = userId !== undefined ? `user:${userId}` : `ip:${req?.ip ?? 'unknown'}`;
    const result = exportLimiter.consume(key);
    // 标准 X-RateLimit-* 响应头
    const res = ctx.switchToHttp().getResponse();
    try {
      res.setHeader('X-RateLimit-Limit', String(EXPORT_LIMIT));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      if (!result.ok) {
        res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      }
    } catch { /* response 已发送时忽略 */ }
    if (!result.ok) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          msg: '导出请求过于频繁，请稍后再试',
          data: { retryAfterMs: result.retryAfterMs },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
