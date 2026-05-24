import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditCore } from './audit.core';

/**
 * 审计日志归档调度器
 * R8.5：每日 02:00 把 created_at < now-180d 的记录迁移到 audit_logs_archive
 * R8.6：单批最多 5000 行，避免长事务
 *
 * 二级清理（防止归档表自身无限增长）：
 *   每周日凌晨 03:00 把 archived_at < now-365d 的记录从归档表彻底删除
 */
@Injectable()
export class AuditArchiveScheduler {
  private readonly logger = new Logger(AuditArchiveScheduler.name);

  constructor(private readonly core: AuditCore) {}

  // 每日 02:00 归档主表
  @Cron('0 2 * * *', { name: 'audit-archive', timeZone: 'Asia/Shanghai' })
  async runDaily() {
    try {
      const start = Date.now();
      const result = await this.core.archive();
      const ms = Date.now() - start;
      if (result.totalMigrated > 0) {
        this.logger.log(`[audit-archive] 归档完成：迁移 ${result.totalMigrated} 条，用时 ${ms}ms`);
      }
    } catch (err) {
      this.logger.error(`[audit-archive] 归档失败：${(err as Error).message}`);
    }
  }

  // 每周日凌晨 03:00 清理归档表自身（保留 365 天）
  @Cron('0 3 * * 0', { name: 'audit-archive-prune', timeZone: 'Asia/Shanghai' })
  async runWeeklyPrune() {
    try {
      const start = Date.now();
      const result = await this.core.pruneArchive(new Date(), 365, 5000, 200);
      const ms = Date.now() - start;
      if (result.totalPruned > 0) {
        this.logger.log(`[audit-archive-prune] 清理完成：删除 ${result.totalPruned} 条归档，用时 ${ms}ms`);
      }
    } catch (err) {
      this.logger.error(`[audit-archive-prune] 清理失败：${(err as Error).message}`);
    }
  }
}
