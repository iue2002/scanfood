import type {
  PrinterRow,
  TemplateRow,
  PrintJobRow,
  PrintJobStatus,
  PrintJobTrigger,
  PrinterPublic,
  TemplateField,
  PrintPayload,
} from './print.types';

export interface PrinterUpsertDto {
  name: string;
  provider: PrinterRow['provider'];
  device_sn?: string | null;
  /** 明文，写库时由 PrintCore 加密 */
  device_key_plain?: string | null;
  role?: PrinterRow['role'];
  enabled?: boolean;
  auto_print?: boolean;
  auto_print_add_more?: boolean;
  template_id?: number | null;
}

export interface PrintRepoPort {
  // ============ 打印机 ============
  insertPrinter(dto: PrinterUpsertDto, deviceKeyEncrypted: string | null): Promise<PrinterRow>;
  updatePrinter(
    id: number,
    patch: Partial<Omit<PrinterUpsertDto, 'device_key_plain'>> & { device_key_enc?: string | null; last_online_at?: Date | null },
  ): Promise<PrinterRow>;
  deletePrinter(id: number): Promise<void>;
  findPrinterById(id: number): Promise<PrinterRow | null>;
  findPrinterByIdWithKey(id: number, decryptKey: (enc: string) => string): Promise<PrinterRow | null>;
  listPrinters(): Promise<PrinterRow[]>;
  listAutoPrinters(trigger: 'NEW_ORDER' | 'ADD_MORE'): Promise<PrinterRow[]>;

  // ============ 模板 ============
  insertTemplate(name: string, fields: TemplateField[], width: TemplateRow['width']): Promise<TemplateRow>;
  updateTemplate(id: number, patch: Partial<Pick<TemplateRow, 'name' | 'fields_json' | 'width'>>): Promise<TemplateRow>;
  deleteTemplate(id: number): Promise<void>;
  findTemplateById(id: number): Promise<TemplateRow | null>;
  listTemplates(): Promise<TemplateRow[]>;

  // ============ 任务 ============
  insertJob(row: Omit<PrintJobRow, 'id' | 'created_at' | 'updated_at' | 'completed_at'>): Promise<PrintJobRow>;
  updateJob(
    id: number,
    patch: Partial<Pick<PrintJobRow, 'status' | 'attempt' | 'last_error' | 'next_retry_at' | 'provider_job_id' | 'completed_at'>>,
  ): Promise<void>;
  /**
   * 取需要下发的任务：status=PENDING 且 (next_retry_at IS NULL OR next_retry_at <= now)
   * 按 created_at asc 排序，单台打印机最多 maxPerPrinter 条
   */
  listDuePending(now: Date, maxPerPrinter: number): Promise<PrintJobRow[]>;
  listJobsByPrinter(printerId: number, limit: number): Promise<PrintJobRow[]>;
  listJobsByOrder(orderId: number): Promise<PrintJobRow[]>;
  /** 7 天前任务清理 */
  deleteOldJobs(cutoff: Date, batchSize: number): Promise<number>;
}
