/**
 * AuditRepoPort：审计日志的持久化端口接口
 * 实现见 audit-repo.drizzle.ts
 */
import type { AuditAction, Role } from '../auth/rbac.types';

export interface AuditRow {
  id?: number;
  actor_user_id: number | null;
  actor_role: Role;
  action: AuditAction;
  target_type: string;
  target_id: string | null;
  /** 序列化后的 JSON 字符串（≤ 8KB），由 AuditCore.serializePayload 产出 */
  payload_json: string;
  ip_address: string;
  user_agent: string;
  created_at: Date;
}

export interface AuditQueryFilter {
  actor_user_id?: number;
  action?: AuditAction;
  target_type?: string;
  target_id?: string;
  start_at?: Date;
  end_at?: Date;
}

export interface PageOptions {
  page: number;
  pageSize: 20 | 50 | 100;
}

export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditRepoPort {
  insert(row: AuditRow): Promise<void>;
  query(filter: AuditQueryFilter, page: PageOptions): Promise<Page<AuditRow>>;
  /**
   * 把 created_at < cutoff 的记录从主表迁移到归档表，单批最多 batchSize 行
   * 返回本次迁移的行数
   */
  archiveOlderThan(cutoff: Date, batchSize: number): Promise<number>;
}
