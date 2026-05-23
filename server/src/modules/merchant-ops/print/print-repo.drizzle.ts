import { Injectable } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { printer_configs, print_templates, print_jobs } from '@/storage/database/shared/schema';
import { and, asc, desc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type {
  PrintRepoPort,
  PrinterUpsertDto,
} from './print-repo.port';
import type {
  PrinterRow,
  PrinterProvider,
  PrinterRole,
  TemplateRow,
  TemplateField,
  PrintWidth,
  PrintJobRow,
  PrintJobStatus,
  PrintJobTrigger,
  PrintPayload,
} from './print.types';

@Injectable()
export class DrizzlePrintRepo implements PrintRepoPort {
  // ============ 工具：raw -> domain row ============
  private toPrinter(r: any, deviceKeyPlain?: string | null): PrinterRow {
    return {
      id: r.id,
      name: r.name,
      provider: r.provider as PrinterProvider,
      device_sn: r.device_sn ?? null,
      device_key: deviceKeyPlain === undefined ? undefined : deviceKeyPlain,
      role: r.role as PrinterRole,
      enabled: !!r.enabled,
      auto_print: !!r.auto_print,
      auto_print_add_more: !!r.auto_print_add_more,
      template_id: r.template_id ?? null,
      last_online_at: r.last_online_at ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }
  private toTemplate(r: any): TemplateRow {
    let fields: TemplateField[] = [];
    if (Array.isArray(r.fields_json)) fields = r.fields_json as TemplateField[];
    else if (typeof r.fields_json === 'string') {
      try { fields = JSON.parse(r.fields_json) as TemplateField[]; } catch { fields = []; }
    }
    return {
      id: r.id,
      name: r.name,
      fields_json: fields,
      width: r.width as PrintWidth,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }
  private toJob(r: any): PrintJobRow {
    let payload: PrintPayload = { width: '80mm', fields: [] } as PrintPayload;
    if (r.payload_json) {
      if (typeof r.payload_json === 'string') {
        try { payload = JSON.parse(r.payload_json) as PrintPayload; } catch { /* keep default */ }
      } else {
        payload = r.payload_json as PrintPayload;
      }
    }
    return {
      id: r.id,
      printer_id: r.printer_id,
      template_id: r.template_id ?? null,
      order_id: r.order_id ?? null,
      trigger: r.trigger as PrintJobTrigger,
      payload_json: payload,
      status: r.status as PrintJobStatus,
      attempt: r.attempt ?? 0,
      last_error: r.last_error ?? null,
      next_retry_at: r.next_retry_at ?? null,
      provider_job_id: r.provider_job_id ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      completed_at: r.completed_at ?? null,
    };
  }

  // ============ 打印机 ============
  async insertPrinter(dto: PrinterUpsertDto, deviceKeyEncrypted: string | null): Promise<PrinterRow> {
    const r: any = await db.insert(printer_configs).values({
      name: dto.name,
      provider: dto.provider,
      device_sn: dto.device_sn ?? null,
      device_key_enc: deviceKeyEncrypted,
      role: dto.role ?? 'BOTH',
      enabled: dto.enabled ?? true,
      auto_print: dto.auto_print ?? false,
      auto_print_add_more: dto.auto_print_add_more ?? false,
      template_id: dto.template_id ?? null,
    });
    const insertId = (r as any)?.[0]?.insertId ?? (r as any)?.insertId;
    const fresh = await db.select().from(printer_configs).where(eq(printer_configs.id, insertId)).limit(1);
    return this.toPrinter(fresh[0]);
  }

  async updatePrinter(id: number, patch: any): Promise<PrinterRow> {
    if (Object.keys(patch).length === 0) {
      const cur = await this.findPrinterById(id);
      if (!cur) throw new Error('printer not found');
      return cur;
    }
    await db.update(printer_configs).set(patch).where(eq(printer_configs.id, id));
    const fresh = await db.select().from(printer_configs).where(eq(printer_configs.id, id)).limit(1);
    if (fresh.length === 0) throw new Error('printer not found after update');
    return this.toPrinter(fresh[0]);
  }

  async deletePrinter(id: number): Promise<void> {
    await db.delete(printer_configs).where(eq(printer_configs.id, id));
  }

  async findPrinterById(id: number): Promise<PrinterRow | null> {
    const rows = await db.select().from(printer_configs).where(eq(printer_configs.id, id)).limit(1);
    if (rows.length === 0) return null;
    return this.toPrinter(rows[0]);
  }

  async findPrinterByIdWithKey(id: number, decryptKey: (enc: string) => string): Promise<PrinterRow | null> {
    const rows = await db.select().from(printer_configs).where(eq(printer_configs.id, id)).limit(1);
    if (rows.length === 0) return null;
    const r: any = rows[0];
    let plain: string | null = null;
    if (r.device_key_enc) {
      try { plain = decryptKey(r.device_key_enc); }
      catch { plain = null; /* 损坏密文：调用方据此返回 DEVICE_KEY_CORRUPTED */ }
    }
    return this.toPrinter(r, plain);
  }

  async listPrinters(): Promise<PrinterRow[]> {
    const rows = await db.select().from(printer_configs).orderBy(asc(printer_configs.id));
    return rows.map((r) => this.toPrinter(r));
  }

  async listAutoPrinters(trigger: 'NEW_ORDER' | 'ADD_MORE'): Promise<PrinterRow[]> {
    const cond = trigger === 'NEW_ORDER'
      ? and(eq(printer_configs.enabled, true), eq(printer_configs.auto_print, true))
      : and(eq(printer_configs.enabled, true), eq(printer_configs.auto_print_add_more, true));
    const rows = await db.select().from(printer_configs).where(cond as any);
    return rows.map((r) => this.toPrinter(r));
  }

  // ============ 模板 ============
  async insertTemplate(name: string, fields: TemplateField[], width: PrintWidth): Promise<TemplateRow> {
    const r: any = await db.insert(print_templates).values({
      name,
      fields_json: fields as any,
      width,
    });
    const insertId = (r as any)?.[0]?.insertId ?? (r as any)?.insertId;
    const fresh = await db.select().from(print_templates).where(eq(print_templates.id, insertId)).limit(1);
    return this.toTemplate(fresh[0]);
  }

  async updateTemplate(id: number, patch: Partial<Pick<TemplateRow, 'name' | 'fields_json' | 'width'>>): Promise<TemplateRow> {
    const setObj: any = { ...patch };
    if (patch.fields_json) setObj.fields_json = patch.fields_json as any;
    if (Object.keys(setObj).length > 0) {
      await db.update(print_templates).set(setObj).where(eq(print_templates.id, id));
    }
    const fresh = await db.select().from(print_templates).where(eq(print_templates.id, id)).limit(1);
    if (fresh.length === 0) throw new Error('template not found');
    return this.toTemplate(fresh[0]);
  }

  async findTemplateById(id: number): Promise<TemplateRow | null> {
    const rows = await db.select().from(print_templates).where(eq(print_templates.id, id)).limit(1);
    if (rows.length === 0) return null;
    return this.toTemplate(rows[0]);
  }

  async listTemplates(): Promise<TemplateRow[]> {
    const rows = await db.select().from(print_templates).orderBy(asc(print_templates.id));
    return rows.map((r) => this.toTemplate(r));
  }

  // ============ 任务 ============
  async insertJob(row: Omit<PrintJobRow, 'id' | 'created_at' | 'updated_at' | 'completed_at'>): Promise<PrintJobRow> {
    const r: any = await db.insert(print_jobs).values({
      printer_id: row.printer_id,
      template_id: row.template_id ?? null,
      order_id: row.order_id ?? null,
      trigger: row.trigger,
      payload_json: row.payload_json as any,
      status: row.status,
      attempt: row.attempt,
      last_error: row.last_error ?? null,
      next_retry_at: row.next_retry_at ?? null,
      provider_job_id: row.provider_job_id ?? null,
    });
    const insertId = (r as any)?.[0]?.insertId ?? (r as any)?.insertId;
    const fresh = await db.select().from(print_jobs).where(eq(print_jobs.id, insertId)).limit(1);
    return this.toJob(fresh[0]);
  }

  async updateJob(id: number, patch: any): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    await db.update(print_jobs).set(patch).where(eq(print_jobs.id, id));
  }

  async listDuePending(now: Date, maxPerPrinter: number): Promise<PrintJobRow[]> {
    // 取所有 PENDING 且 (next_retry_at IS NULL OR <= now) 的任务，按 created_at asc 排序
    // 单台打印机的限流由 core 层做（避免 SQL 复杂化）
    const rows = await db
      .select()
      .from(print_jobs)
      .where(
        and(
          eq(print_jobs.status, 'PENDING'),
          or(sql`${print_jobs.next_retry_at} IS NULL`, lte(print_jobs.next_retry_at, now)),
        ) as any,
      )
      .orderBy(asc(print_jobs.created_at))
      .limit(maxPerPrinter * 50); // 上限：50 台打印机 * maxPerPrinter；core 再做精确分组
    return rows.map((r) => this.toJob(r));
  }

  async listJobsByPrinter(printerId: number, limit: number): Promise<PrintJobRow[]> {
    const rows = await db
      .select()
      .from(print_jobs)
      .where(eq(print_jobs.printer_id, printerId))
      .orderBy(desc(print_jobs.created_at))
      .limit(limit);
    return rows.map((r) => this.toJob(r));
  }

  async listJobsByOrder(orderId: number): Promise<PrintJobRow[]> {
    const rows = await db
      .select()
      .from(print_jobs)
      .where(eq(print_jobs.order_id, orderId))
      .orderBy(desc(print_jobs.created_at));
    return rows.map((r) => this.toJob(r));
  }

  async deleteOldJobs(cutoff: Date, batchSize: number): Promise<number> {
    const old = await db
      .select({ id: print_jobs.id })
      .from(print_jobs)
      .where(lt(print_jobs.created_at, cutoff))
      .orderBy(asc(print_jobs.created_at))
      .limit(batchSize);
    if (old.length === 0) return 0;
    const ids = old.map((r) => r.id);
    await db.delete(print_jobs).where(inArray(print_jobs.id, ids));
    return old.length;
  }
}
