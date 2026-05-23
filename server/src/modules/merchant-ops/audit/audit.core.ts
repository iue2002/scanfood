/**
 * AuditCore：审计日志领域核心（纯类，无 I/O 依赖）
 *
 * 职责：
 * - serializePayload / deserializePayload 完成 8KB 截断 + JSON round-trip 性质（I8）
 * - validateRange 90 天上限（I9）
 * - write 把 payload + actor 上下文写入 RepoPort
 * - query / archive 委托 Repo
 *
 * 属性测试目标：
 * - Property 7: 密码字段绝不出现在序列化结果（递归脱敏）
 * - Property 8: serialize→deserialize round-trip 等价 + ≤ 8192 字节
 * - Property 9: 90 天窗口
 * - Property 10: 归档划分正确
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type {
  AuditRepoPort,
  AuditRow,
  AuditQueryFilter,
  PageOptions,
  Page,
} from './audit-repo.port';
import type { ActorContext, AuditAction, AuditPayload } from '../auth/rbac.types';

const PAYLOAD_BYTE_LIMIT = 8192;
const QUERY_RANGE_LIMIT_MS = 90 * 24 * 60 * 60 * 1000;

// 敏感字段名（递归脱敏）。匹配规则：完全等于 / 包含这些子串
const SENSITIVE_KEYS = ['password', 'pwd', 'secret', 'token', 'devicekey', 'device_key', 'apikey', 'api_key', 'private_key'];

@Injectable()
export class AuditCore {
  private readonly logger = new Logger(AuditCore.name);

  constructor(private readonly repo: AuditRepoPort) {}

  // ============================================================
  // 静态方法：纯逻辑，可直接 PBT
  // ============================================================

  /**
   * 递归脱敏 payload：把任何含敏感字段名的 value 替换为 '[REDACTED]'
   * Property 7：保证明文密码绝不出现在审计 payload
   */
  static redact<T = unknown>(value: T): T {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
      return value.map((v) => AuditCore.redact(v)) as unknown as T;
    }
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const lower = k.toLowerCase();
        const isSensitive = SENSITIVE_KEYS.some((s) => lower === s || lower.includes(s));
        out[k] = isSensitive ? '[REDACTED]' : AuditCore.redact(v);
      }
      return out as unknown as T;
    }
    return value;
  }

  /**
   * I8：序列化 + 8KB 截断
   * 返回 { json, truncated }；截断时优先丢弃 before/after 中的字符串字段
   * 不变量（PBT 验证）：
   *   1. json.length ≤ 8192
   *   2. deserializePayload(json) 等价于 canonicalize(redact(p))
   *   3. 截断时 _truncated = true，关键字段 action/targetType/targetId 保留
   */
  static serializePayload(p: AuditPayload): { json: string; truncated: boolean } {
    const redacted = AuditCore.redact(p);
    let json = JSON.stringify(redacted);
    if (json.length <= PAYLOAD_BYTE_LIMIT) {
      return { json, truncated: false };
    }

    // 超长：尝试逐步丢弃 / 截断 before、after、meta 中的字符串值
    const truncated: AuditPayload = JSON.parse(JSON.stringify(redacted));
    truncated._truncated = true;

    // 步骤 1：截断 before/after/meta 中的所有字符串字段到 200 字符
    const stringTrunc = (obj: Record<string, unknown> | undefined) => {
      if (!obj) return;
      for (const k in obj) {
        const v = obj[k];
        if (typeof v === 'string' && v.length > 200) {
          obj[k] = v.slice(0, 200) + '…[TRUNCATED]';
        } else if (typeof v === 'object' && v !== null) {
          stringTrunc(v as Record<string, unknown>);
        }
      }
    };
    stringTrunc(truncated.before);
    stringTrunc(truncated.after);
    stringTrunc(truncated.meta);
    json = JSON.stringify(truncated);

    // 步骤 2：还超长 → 整个丢弃 meta
    if (json.length > PAYLOAD_BYTE_LIMIT && truncated.meta) {
      delete truncated.meta;
      json = JSON.stringify(truncated);
    }
    // 步骤 3：还超长 → 丢弃 before
    if (json.length > PAYLOAD_BYTE_LIMIT && truncated.before) {
      truncated.before = { _omitted: true };
      json = JSON.stringify(truncated);
    }
    // 步骤 4：还超长 → 丢弃 after
    if (json.length > PAYLOAD_BYTE_LIMIT && truncated.after) {
      truncated.after = { _omitted: true };
      json = JSON.stringify(truncated);
    }
    // 步骤 5：仍超长 → 关键字段最小化
    if (json.length > PAYLOAD_BYTE_LIMIT) {
      const minimal: AuditPayload = {
        action: truncated.action,
        targetType: truncated.targetType,
        targetId: truncated.targetId,
        _truncated: true,
      };
      json = JSON.stringify(minimal);
    }
    return { json, truncated: true };
  }

  static deserializePayload(json: string): AuditPayload {
    return JSON.parse(json) as AuditPayload;
  }

  /**
   * I9：审计查询区间约束
   * 接受当且仅当 startAt < endAt 且 endAt - startAt ≤ 90 天
   */
  static validateRange(startAt: Date, endAt: Date): { ok: true } | { ok: false; code: string } {
    if (!(startAt instanceof Date) || !(endAt instanceof Date)) {
      return { ok: false, code: 'RANGE_INVALID' };
    }
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      return { ok: false, code: 'RANGE_INVALID' };
    }
    if (startAt.getTime() >= endAt.getTime()) return { ok: false, code: 'RANGE_INVALID' };
    if (endAt.getTime() - startAt.getTime() > QUERY_RANGE_LIMIT_MS) {
      return { ok: false, code: 'RANGE_TOO_LARGE' };
    }
    return { ok: true };
  }

  // ============================================================
  // 业务方法
  // ============================================================

  /**
   * 写入一条审计记录。failure 仅记日志，不冒泡（I7：审计写失败不应导致主请求 500）
   */
  async write(actor: ActorContext, payload: AuditPayload): Promise<void> {
    try {
      const { json } = AuditCore.serializePayload(payload);
      const row: AuditRow = {
        actor_user_id: actor?.userId ?? null,
        actor_role: actor?.role ?? ('admin' as any),
        action: payload.action,
        target_type: payload.targetType,
        target_id: payload.targetId ?? null,
        payload_json: json,
        ip_address: (actor?.ip || 'unknown').slice(0, 45),
        user_agent: (actor?.userAgent || 'unknown').slice(0, 500),
        created_at: new Date(),
      };
      await this.repo.insert(row);
    } catch (err) {
      this.logger.error(
        `[audit] 写入失败 action=${payload.action}, target=${payload.targetType}/${payload.targetId}: ${(err as Error).message}`,
      );
    }
  }

  async query(filter: AuditQueryFilter, page: PageOptions): Promise<Page<AuditRow>> {
    if (filter.start_at && filter.end_at) {
      const v = AuditCore.validateRange(filter.start_at, filter.end_at);
      if (!v.ok) throw new BadRequestException({ code: v.code, msg: '查询区间非法或超过 90 天' });
    }
    return await this.repo.query(filter, page);
  }

  /**
   * R8.5：归档作业。把 created_at < cutoff（默认 now - 180d）的记录批量迁移到归档表。
   * R8.6：单批最多 5000 行；持续直到没有可迁移记录或达到最大轮数。
   */
  async archive(now: Date = new Date(), retentionDays = 180, batchSize = 5000, maxRounds = 200): Promise<{ totalMigrated: number }> {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    let total = 0;
    for (let i = 0; i < maxRounds; i++) {
      const migrated = await this.repo.archiveOlderThan(cutoff, batchSize);
      total += migrated;
      if (migrated < batchSize) break;
    }
    return { totalMigrated: total };
  }
}
