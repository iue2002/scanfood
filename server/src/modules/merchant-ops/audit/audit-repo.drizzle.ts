import { Injectable } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { audit_logs, audit_logs_archive } from '@/storage/database/shared/schema';
import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type {
  AuditRepoPort,
  AuditRow,
  AuditQueryFilter,
  PageOptions,
  Page,
} from './audit-repo.port';
import type { AuditAction, Role } from '../auth/rbac.types';

@Injectable()
export class DrizzleAuditRepo implements AuditRepoPort {
  private mapRow(r: any): AuditRow {
    return {
      id: r.id,
      actor_user_id: r.actor_user_id ?? null,
      actor_role: r.actor_role as Role,
      action: r.action as AuditAction,
      target_type: r.target_type,
      target_id: r.target_id ?? null,
      // DB 列是 json 类型，drizzle 自动反序列化为 object，统一转回字符串以贴合接口
      payload_json: typeof r.payload_json === 'string' ? r.payload_json : JSON.stringify(r.payload_json),
      ip_address: r.ip_address ?? 'unknown',
      user_agent: r.user_agent ?? 'unknown',
      created_at: r.created_at,
    };
  }

  async insert(row: AuditRow): Promise<void> {
    // payload_json 已是字符串，drizzle 的 json 列接受字符串/对象都能写入
    await db.insert(audit_logs).values({
      actor_user_id: row.actor_user_id ?? null,
      actor_role: row.actor_role,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id ?? null,
      payload_json: row.payload_json as any,
      ip_address: row.ip_address || 'unknown',
      user_agent: row.user_agent || 'unknown',
    });
  }

  async query(filter: AuditQueryFilter, page: PageOptions): Promise<Page<AuditRow>> {
    const conds: any[] = [];
    if (filter.actor_user_id !== undefined) conds.push(eq(audit_logs.actor_user_id, filter.actor_user_id));
    if (filter.action) conds.push(eq(audit_logs.action, filter.action));
    if (filter.target_type) conds.push(eq(audit_logs.target_type, filter.target_type));
    if (filter.target_id) conds.push(eq(audit_logs.target_id, filter.target_id));
    if (filter.start_at) conds.push(gte(audit_logs.created_at, filter.start_at));
    if (filter.end_at) conds.push(lte(audit_logs.created_at, filter.end_at));

    const where = conds.length > 0 ? and(...conds) : undefined;

    const totalRows = await db.select({ c: sql<number>`count(*)` }).from(audit_logs).where(where as any);
    const total = Number(totalRows[0]?.c ?? 0);

    const offset = Math.max(0, (page.page - 1) * page.pageSize);
    const rows = await db.select().from(audit_logs).where(where as any)
      .orderBy(desc(audit_logs.created_at))
      .limit(page.pageSize)
      .offset(offset);

    return {
      data: rows.map((r) => this.mapRow(r)),
      total,
      page: page.page,
      pageSize: page.pageSize,
    };
  }

  async archiveOlderThan(cutoff: Date, batchSize: number): Promise<number> {
    // 1) 按 created_at 升序取一批 id
    const rows = await db.select().from(audit_logs)
      .where(lt(audit_logs.created_at, cutoff))
      .orderBy(asc(audit_logs.created_at))
      .limit(batchSize);
    if (rows.length === 0) return 0;

    // 2) 批量插入归档表
    const toArchive = rows.map((r) => ({
      id: r.id,
      actor_user_id: r.actor_user_id,
      actor_role: r.actor_role,
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id,
      payload_json: r.payload_json as any,
      ip_address: r.ip_address,
      user_agent: r.user_agent,
      created_at: r.created_at,
    }));
    await db.insert(audit_logs_archive).values(toArchive as any);

    // 3) 从主表删除（按 id IN (...)）
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await db.delete(audit_logs).where(sql`${audit_logs.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    }
    return rows.length;
  }
}
