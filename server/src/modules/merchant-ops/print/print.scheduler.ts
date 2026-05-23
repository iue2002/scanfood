import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrintCore } from './print.core';

/**
 * 打印调度器
 *
 * - 每 30 秒跑 retry tick：发送 PENDING 任务，按指数退避调度重试
 * - 每天凌晨 03:00 清理 7 天前的任务（R17.6）
 */
@Injectable()
export class PrintScheduler {
  private readonly logger = new Logger(PrintScheduler.name);

  constructor(private readonly core: PrintCore) {}

  @Cron('*/30 * * * * *') // 每 30 秒
  async runRetryTick() {
    try {
      const r = await this.core.runRetryTick();
      if (r.sent > 0 || r.failed > 0) {
        this.logger.log(`[print-tick] sent=${r.sent} failed=${r.failed}`);
      }
    } catch (err) {
      this.logger.error(`[print-tick] failed: ${(err as Error).message}`);
    }
  }

  @Cron('0 0 3 * * *') // 每天 03:00
  async cleanup() {
    try {
      const r = await this.core.cleanupOldJobs(new Date(), 7, 1000);
      if (r.removed > 0) {
        this.logger.log(`[print-cleanup] removed ${r.removed} old jobs`);
      }
    } catch (err) {
      this.logger.error(`[print-cleanup] failed: ${(err as Error).message}`);
    }
  }
}
