/**
 * Export 持久化 + 只读订单/报表数据投影 端口接口
 *
 * DI-7：ExportCore 不能 import OrdersService。所有读全部走 ReadOnlyOrdersPort 投影。
 */
import type {
  ExportJobRow,
  ExportJobStatus,
  ExportJobType,
  OrderExportRow,
  ReportAggregate,
  ReportType,
  OrderStatusFilter,
} from './export.types';

export interface ExportRepoPort {
  insertJob(row: Omit<ExportJobRow, 'created_at' | 'updated_at' | 'completed_at'> & { params_json: Record<string, unknown> | null }): Promise<void>;
  getJob(jobId: string): Promise<ExportJobRow | null>;
  updateJob(
    jobId: string,
    patch: Partial<Pick<ExportJobRow, 'status' | 'progress' | 'row_count' | 'file_path' | 'file_size' | 'file_name' | 'mime_type' | 'error_code' | 'error_message' | 'completed_at'>>,
  ): Promise<void>;
  /** R11.8：清理 created_at < cutoff 且 file_path 非空的任务文件路径 */
  listExpired(cutoff: Date, batchSize: number): Promise<ExportJobRow[]>;
  /** 清理 created_at < cutoff 且 status ∈ {success, failed} 的任务行（已完全结束的可丢） */
  deleteCompletedJobs(cutoff: Date, batchSize: number): Promise<number>;
}

export interface ReadOnlyOrdersPort {
  countOrders(startAt: Date, endAt: Date, status?: OrderStatusFilter[]): Promise<number>;
  /** 流式分批返回，避免一次性把全表搬到内存（R11.5） */
  streamOrders(
    startAt: Date,
    endAt: Date,
    status: OrderStatusFilter[] | undefined,
    onBatch: (rows: OrderExportRow[]) => Promise<void>,
    batchSize?: number,
  ): Promise<{ totalRows: number }>;
  /** 报表聚合：按 type/date 计算 */
  aggregateForReport(
    type: ReportType,
    date: string,
    storeName: string,
    generatedBy: string,
  ): Promise<ReportAggregate>;
}
