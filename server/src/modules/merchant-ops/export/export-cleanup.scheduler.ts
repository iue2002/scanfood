import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExportCore } from './export.core';

/**
 * R11.8：每小时清理 24 小时前的异步导出任务文件
 */
@Injectable()
export class ExportCleanupScheduler {
  private readonly logger = new Logger(ExportCleanupScheduler.name);

  constructor(private readonly core: ExportCore) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run() {
    try {
      const result = await this.core.cleanupExpired(new Date(), 24, 200);
      if (result.removed > 0) {
        this.logger.log(`[export-cleanup] removed ${result.removed} expired files`);
      }
    } catch (err) {
      this.logger.error(`[export-cleanup] failed: ${(err as Error).message}`);
    }
  }
}
