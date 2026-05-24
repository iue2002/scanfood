import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { exportLimiter } from './rate-limit.guard';

/**
 * 速率限制器内存桶清理调度器
 *
 * 长期运行的进程里，rate-limiter 的 buckets Map 会随用户访问积累 key。
 * 每个 key 在窗口过期后没有 active 条目了，但桶本身仍占内存。
 * 每 5 分钟扫一次，把空桶 evict 掉。
 */
@Injectable()
export class RateLimitSweepScheduler {
  private readonly logger = new Logger(RateLimitSweepScheduler.name);

  @Cron(CronExpression.EVERY_5_MINUTES)
  sweepExportLimiter() {
    try {
      const before = exportLimiter.size();
      const r = exportLimiter.sweep();
      if (r.removed > 0) {
        this.logger.log(`[rate-limit-sweep] export limiter: ${before} → ${exportLimiter.size()} (removed ${r.removed} empty buckets)`);
      }
    } catch (err) {
      this.logger.warn(`[rate-limit-sweep] failed: ${(err as Error).message}`);
    }
  }
}
