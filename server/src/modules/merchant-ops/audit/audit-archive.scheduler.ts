import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditCore } from './audit.core';

/**
 * 审计日志归档调度器
 * R8.5：每日 02:00 把 created_at < now-180d 的记录迁移到 audit_logs_archive
 * R8.6：单批最多 5000 行，避免长事务
 */
@Injectable()
export class AuditArchiveScheduler {
  private readonly logger = new Logger(AuditArchiveScheduler.name);

  constructor(private readonly core: AuditCore) {}

  // 每日 02:00 跑一次（中国时区按系统设置；服务器 UTC 时只需关注相对时间）
  @Cron('0 2 * * *', { name: 'audit-archive', timeZone: 'Asia/Shanghai' })
  async runDaily() {
    try {
      const start = Date.now();
      const result = await this.core.archive();
      const ms = Date.now() - start;
      this.logger.log(
        `[audit-archive] 归档完成：迁移 ${result.totalMigrated} 条，用时 ${ms}ms`,
      );
    } catch (err) {
      this.logger.error(`[audit-archive] 归档失败：${(err as Error).message}`);
    }
  }
}
