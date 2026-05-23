import { Injectable } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { export_jobs } from '@/storage/database/shared/schema';
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { ExportRepoPort } from './export-repo.port';
import type { ExportJobRow, ExportJobStatus, ExportJobType } from './export.types';

@Injectable()
export class DrizzleExportRepo implements ExportRepoPort {
  private mapRow(r: any): ExportJobRow {
    let params: Record<string, unknown> | null = null;
    if (r.params_json) {
      if (typeof r.params_json === 'string') {
        try { params = JSON.parse(r.params_json); } catch { params = null; }
      } else {
        params = r.params_json as Record<string, unknown>;
      }
    }
    return {
      id: r.id,
      actor_user_id: r.actor_user_id,
      type: r.type as ExportJobType,
      status: r.status as ExportJobStatus,
      progress: r.progress ?? 0,
      row_count: r.row_count ?? null,
      file_path: r.file_path ?? null,
      file_size: r.file_size ?? null,
      file_name: r.file_name ?? null,
      mime_type: r.mime_type ?? null,
      error_code: r.error_code ?? null,
      error_message: r.error_message ?? null,
      params_json: params,
      created_at: r.created_at,
      updated_at: r.updated_at,
      completed_at: r.completed_at ?? null,
    };
  }

  async insertJob(row: any): Promise<void> {
    await db.insert(export_jobs).values({
      id: row.id,
      actor_user_id: row.actor_user_id,
      type: row.type,
      status: row.status,
      progress: row.progress ?? 0,
      row_count: row.row_count ?? null,
      file_path: row.file_path ?? null,
      file_size: row.file_size ?? null,
      file_name: row.file_name ?? null,
      mime_type: row.mime_type ?? null,
      error_code: row.error_code ?? null,
      error_message: row.error_message ?? null,
      params_json: (row.params_json ?? null) as any,
    });
  }

  async getJob(jobId: string): Promise<ExportJobRow | null> {
    const rows = await db.select().from(export_jobs).where(eq(export_jobs.id, jobId)).limit(1);
    if (rows.length === 0) return null;
    return this.mapRow(rows[0]);
  }

  async updateJob(jobId: string, patch: any): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    await db.update(export_jobs).set(patch).where(eq(export_jobs.id, jobId));
  }

  async listExpired(cutoff: Date, batchSize: number): Promise<ExportJobRow[]> {
    const rows = await db
      .select()
      .from(export_jobs)
      .where(and(lt(export_jobs.created_at, cutoff), isNotNull(export_jobs.file_path)))
      .orderBy(export_jobs.created_at)
      .limit(batchSize);
    return rows.map((r) => this.mapRow(r));
  }
}
