/**
 * ExportCore：导出领域核心
 *
 * 纯类 + 静态规则方法（PBT 友好）；I/O 通过 RepoPort + ArtifactPort 注入
 *
 * 不变量：
 * - I20（区间约束）：start < end ∧ end - start ≤ 92 天 → Property 13
 * - 审计 payload 只允许指定字段集 → Property 14
 *
 * 异常隔离（R19.5）：所有方法在 controller 层吞错误；core 内部失败仅抛 BadRequestException 等领域异常
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import type {
  ExportRepoPort,
  ReadOnlyOrdersPort,
} from './export-repo.port';
import type {
  ExportJobRow,
  ExportJobType,
  ExportOrdersDto,
  ExportReportDto,
  OrderExportRow,
  ReportAggregate,
} from './export.types';
import {
  RANGE_LIMIT_DAYS,
  SYNC_THRESHOLD,
} from './export.types';
import type { ActorContext } from '../auth/rbac.types';

const ORDER_AUDIT_ALLOWED_KEYS: ReadonlyArray<string> = ['startAt', 'endAt', 'rowCount', 'jobId'];
const REPORT_AUDIT_ALLOWED_KEYS: ReadonlyArray<string> = ['type', 'date', 'rowCount'];
const FORBIDDEN_DETAIL_KEYS: ReadonlyArray<string> = [
  'dish_name', 'spec_name', 'subtotal', 'order_items', 'refund_reason',
];

/**
 * Artifact（产物文件）写入端口；测试时可注入内存版
 */
export interface ExportArtifactPort {
  /** Excel：传入流式 writer，core 把每批 OrderExportRow 喂给它；返回最终文件路径 + 大小 */
  buildOrdersXlsx(
    jobId: string,
    headers: string[],
    runStream: (push: (row: any[]) => Promise<void>) => Promise<void>,
  ): Promise<{ filePath: string; fileSize: number; fileName: string }>;
  /** 同步小批量 Excel：直接构造 buffer */
  buildOrdersXlsxBuffer(headers: string[], rows: any[][]): Promise<{ buffer: Buffer; fileName: string }>;
  /** PDF 报表：核心数据 → buffer */
  buildReportPdf(agg: ReportAggregate): Promise<{ buffer: Buffer; fileName: string }>;
  /** 删文件（清理）；不存在视为成功 */
  removeFile(filePath: string): Promise<void>;
}

@Injectable()
export class ExportCore {
  private readonly logger = new Logger(ExportCore.name);

  constructor(
    private readonly repo: ExportRepoPort,
    private readonly orders: ReadOnlyOrdersPort,
    private readonly artifact: ExportArtifactPort,
    private readonly storeNameProvider: () => Promise<string>,
  ) {}

  // ============================================================
  // 静态规则（PBT）
  // ============================================================

  /**
   * I20：start < end ∧ end - start ≤ 92 天
   * 时间 ms = 92 * 86_400_000
   */
  static validateOrderRange(startAt: Date, endAt: Date): { ok: true } | { ok: false; code: 'RANGE_INVALID' } {
    const limitMs = RANGE_LIMIT_DAYS * 24 * 60 * 60 * 1000;
    if (!(startAt instanceof Date) || !(endAt instanceof Date)) return { ok: false, code: 'RANGE_INVALID' };
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) return { ok: false, code: 'RANGE_INVALID' };
    if (startAt.getTime() >= endAt.getTime()) return { ok: false, code: 'RANGE_INVALID' };
    if (endAt.getTime() - startAt.getTime() > limitMs) return { ok: false, code: 'RANGE_INVALID' };
    return { ok: true };
  }

  /**
   * Property 14：构造 EXPORT_ORDERS audit payload。
   * 只允许 {startAt, endAt, rowCount, jobId}，且不出现订单内部字段名。
   */
  static buildOrdersAuditPayload(args: {
    startAt: string;
    endAt: string;
    rowCount: number;
    jobId: string | null;
  }): Record<string, unknown> {
    const out: Record<string, unknown> = {
      startAt: args.startAt,
      endAt: args.endAt,
      rowCount: args.rowCount,
      jobId: args.jobId,
    };
    return ExportCore.assertAuditPayloadShape(out, ORDER_AUDIT_ALLOWED_KEYS);
  }

  /**
   * Property 14：构造 EXPORT_REPORT audit payload。
   * 只允许 {type, date, rowCount}。
   */
  static buildReportAuditPayload(args: {
    type: 'DAILY' | 'MONTHLY';
    date: string;
    rowCount: number;
  }): Record<string, unknown> {
    const out: Record<string, unknown> = {
      type: args.type,
      date: args.date,
      rowCount: args.rowCount,
    };
    return ExportCore.assertAuditPayloadShape(out, REPORT_AUDIT_ALLOWED_KEYS);
  }

  /**
   * 防御性自检：构造结果只包含 allowedKeys，且不含 FORBIDDEN_DETAIL_KEYS。
   * 抛出代表代码 bug，不应该被业务命中（PBT 验证）。
   */
  static assertAuditPayloadShape(
    obj: Record<string, unknown>,
    allowedKeys: ReadonlyArray<string>,
  ): Record<string, unknown> {
    const keys = Object.keys(obj);
    for (const k of keys) {
      if (!allowedKeys.includes(k)) {
        throw new Error(`audit payload contains forbidden key: ${k}`);
      }
    }
    const json = JSON.stringify(obj);
    for (const banned of FORBIDDEN_DETAIL_KEYS) {
      // 这里检查序列化后字符串里不出现禁词（连作为 value 都不允许）
      if (json.includes(`"${banned}"`)) {
        throw new Error(`audit payload contains forbidden detail key: ${banned}`);
      }
    }
    return obj;
  }

  // ============================================================
  // 业务方法
  // ============================================================

  /**
   * R11.1-R11.5：Excel 订单导出
   *
   * - count ≤ 5000：同步生成 buffer + 返回 { kind: 'sync', buffer }
   * - count > 5000：创建 export job，异步流式生成；返回 { kind: 'async', jobId, expectedRowCount }
   */
  async exportOrders(
    actor: ActorContext,
    dto: ExportOrdersDto,
  ): Promise<
    | { kind: 'sync'; buffer: Buffer; fileName: string; rowCount: number }
    | { kind: 'async'; jobId: string; expectedRowCount: number }
  > {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    const v = ExportCore.validateOrderRange(startAt, endAt);
    if (!v.ok) {
      throw new BadRequestException({ code: v.code, msg: '导出时间范围非法或超过 92 天' });
    }

    const total = await this.orders.countOrders(startAt, endAt, dto.status);

    const headers = ['订单号', '桌号', '类型', '下单时间', '状态', '菜品明细', '金额', '退款', '操作员'];

    if (total <= SYNC_THRESHOLD) {
      // 同步路径
      const rows: any[][] = [];
      await this.orders.streamOrders(startAt, endAt, dto.status, async (batch) => {
        for (const r of batch) {
          rows.push(this.toExcelRow(r));
        }
      });
      const { buffer, fileName } = await this.artifact.buildOrdersXlsxBuffer(headers, rows);
      return { kind: 'sync', buffer, fileName, rowCount: rows.length };
    }

    // 异步路径
    const jobId = uuidv4();
    await this.repo.insertJob({
      id: jobId,
      actor_user_id: actor.userId,
      type: 'ORDERS',
      status: 'pending',
      progress: 0,
      row_count: total,
      file_path: null,
      file_size: null,
      file_name: null,
      mime_type: null,
      error_code: null,
      error_message: null,
      params_json: { startAt: dto.startAt, endAt: dto.endAt, status: dto.status ?? null },
    });
    // 异步执行（不 await）；失败统一收敛在 runner 内
    void this.runOrdersJob(jobId, startAt, endAt, dto.status, headers, total).catch((err) => {
      this.logger.error(`[export] async job ${jobId} unhandled error: ${(err as Error).message}`);
    });

    return { kind: 'async', jobId, expectedRowCount: total };
  }

  private async runOrdersJob(
    jobId: string,
    startAt: Date,
    endAt: Date,
    statusFilter: ExportOrdersDto['status'],
    headers: string[],
    expectedTotal: number,
  ): Promise<void> {
    try {
      await this.repo.updateJob(jobId, { status: 'running', progress: 1 });

      let processed = 0;
      const result = await this.artifact.buildOrdersXlsx(jobId, headers, async (push) => {
        await this.orders.streamOrders(startAt, endAt, statusFilter, async (batch) => {
          for (const r of batch) {
            await push(this.toExcelRow(r));
          }
          processed += batch.length;
          if (expectedTotal > 0) {
            const pct = Math.min(99, Math.floor((processed / expectedTotal) * 99));
            // progress 节流：每 5% 才写一次，避免 DB 拥塞
            if (pct % 5 === 0) {
              try { await this.repo.updateJob(jobId, { progress: pct }); } catch { /* ignore */ }
            }
          }
        });
      });

      await this.repo.updateJob(jobId, {
        status: 'success',
        progress: 100,
        row_count: processed,
        file_path: result.filePath,
        file_size: result.fileSize,
        file_name: result.fileName,
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        completed_at: new Date(),
      });
    } catch (err) {
      const msg = (err as Error).message || 'unknown';
      this.logger.error(`[export] orders job ${jobId} failed: ${msg}`);
      await this.repo.updateJob(jobId, {
        status: 'failed',
        error_code: 'EXPORT_FAILED',
        error_message: msg.slice(0, 500),
        completed_at: new Date(),
      });
    }
  }

  /**
   * R11.6：查询任务状态
   * 仅允许查询自己的任务（actor.userId 必须匹配 actor_user_id）
   */
  async getJob(actor: ActorContext, jobId: string): Promise<ExportJobRow> {
    const job = await this.repo.getJob(jobId);
    if (!job) {
      throw new BadRequestException({ code: 'EXPORT_JOB_NOT_FOUND', msg: '任务不存在' });
    }
    if (job.actor_user_id !== actor.userId) {
      throw new BadRequestException({ code: 'EXPORT_JOB_FORBIDDEN', msg: '无权查看他人任务' });
    }
    return job;
  }

  /**
   * R11.5：下载产物
   */
  async getJobForDownload(actor: ActorContext, jobId: string): Promise<{ filePath: string; fileName: string; mimeType: string; fileSize: number }> {
    const job = await this.getJob(actor, jobId);
    if (job.status !== 'success' || !job.file_path) {
      throw new BadRequestException({ code: 'EXPORT_NOT_READY', msg: '任务尚未完成' });
    }
    return {
      filePath: job.file_path,
      fileName: job.file_name ?? 'export.xlsx',
      mimeType: job.mime_type ?? 'application/octet-stream',
      fileSize: job.file_size ?? 0,
    };
  }

  /**
   * R12：报表 PDF 导出
   * 同步生成（PDFKit 在内存生成，量小）
   */
  async exportReport(
    actor: ActorContext,
    dto: ExportReportDto,
  ): Promise<{ buffer: Buffer; fileName: string; rowCount: number }> {
    if (dto.type !== 'DAILY' && dto.type !== 'MONTHLY') {
      throw new BadRequestException({ code: 'RANGE_INVALID', msg: '报表类型非法' });
    }
    if (!ExportCore.isValidReportDate(dto.type, dto.date)) {
      throw new BadRequestException({ code: 'RANGE_INVALID', msg: '日期格式非法' });
    }
    const storeName = await this.storeNameProvider();
    const agg = await this.orders.aggregateForReport(dto.type, dto.date, storeName, actor.role);
    const { buffer, fileName } = await this.artifact.buildReportPdf(agg);
    if (buffer.length > 20 * 1024 * 1024) {
      throw new BadRequestException({ code: 'REPORT_GENERATION_FAILED', msg: '报表过大' });
    }
    return { buffer, fileName, rowCount: agg.orderCount };
  }

  static isValidReportDate(type: 'DAILY' | 'MONTHLY', date: string): boolean {
    if (type === 'DAILY') return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date + 'T00:00:00Z'));
    if (type === 'MONTHLY') return /^\d{4}-\d{2}$/.test(date) && !isNaN(Date.parse(date + '-01T00:00:00Z'));
    return false;
  }

  /**
   * R11.8：定时清理 24 小时前 file_path 仍存在的任务文件（每 1 小时跑一次）
   */
  async cleanupExpired(now: Date = new Date(), retentionHours = 24, batchSize = 100): Promise<{ removed: number }> {
    const cutoff = new Date(now.getTime() - retentionHours * 60 * 60 * 1000);
    const expired = await this.repo.listExpired(cutoff, batchSize);
    let removed = 0;
    for (const job of expired) {
      if (!job.file_path) continue;
      try {
        await this.artifact.removeFile(job.file_path);
        await this.repo.updateJob(job.id, { file_path: null });
        removed += 1;
      } catch (err) {
        this.logger.warn(`[export] cleanup failed for job ${job.id}: ${(err as Error).message}`);
      }
    }
    return { removed };
  }

  // ============================================================
  // 内部工具
  // ============================================================
  private toExcelRow(r: OrderExportRow): any[] {
    return [
      r.order_number,
      r.table_number,
      r.order_type === 'takeaway' ? '外带' : '堂食',
      this.fmtDateTime(r.created_at),
      this.statusLabel(r.status),
      r.item_summary,
      r.total_amount,
      r.refund_amount,
      r.operator,
    ];
  }
  private fmtDateTime(d: Date): string {
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  private statusLabel(s: string): string {
    switch (s) {
      case 'submitted': return '已提交';
      case 'printed': return '已打印';
      case 'settled': return '已结账';
      case 'cancelled': return '已取消';
      case 'refunded': return '已退款';
      default: return s;
    }
  }
}
