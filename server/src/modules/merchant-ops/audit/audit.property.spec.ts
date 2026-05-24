/**
 * Feature: merchant-ops-center, Property 7/8/9/10: Audit invariants
 * Validates: Requirements 6.6, 7.5, 7.6, 7.7, 8.3, 8.5, 8.6, 20.4
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { AuditCore } from './audit.core';
import type { AuditPayload, AuditAction, ActorContext } from '../auth/rbac.types';
import type {
  AuditRepoPort,
  AuditRow,
  AuditQueryFilter,
  Page,
  PageOptions,
} from './audit-repo.port';

// ============================================================
// 测试用 Stub Repo（in-memory）
// ============================================================
class StubAuditRepo implements AuditRepoPort {
  rows: AuditRow[] = [];
  archived: AuditRow[] = [];
  // 模拟自增 id
  private nextId = 1;

  async insert(row: AuditRow): Promise<void> {
    this.rows.push({ ...row, id: this.nextId++ });
  }

  async query(filter: AuditQueryFilter, page: PageOptions): Promise<Page<AuditRow>> {
    const filtered = this.rows.filter((r) => {
      if (filter.action && r.action !== filter.action) return false;
      if (filter.actor_user_id !== undefined && r.actor_user_id !== filter.actor_user_id) return false;
      if (filter.target_type && r.target_type !== filter.target_type) return false;
      if (filter.target_id && r.target_id !== filter.target_id) return false;
      if (filter.start_at && r.created_at < filter.start_at) return false;
      if (filter.end_at && r.created_at > filter.end_at) return false;
      return true;
    });
    const offset = Math.max(0, (page.page - 1) * page.pageSize);
    return {
      data: filtered.slice(offset, offset + page.pageSize),
      total: filtered.length,
      page: page.page,
      pageSize: page.pageSize,
    };
  }

  async archiveOlderThan(cutoff: Date, batchSize: number): Promise<number> {
    // 选最旧的 ≤ batchSize 行
    const old = this.rows
      .filter((r) => r.created_at < cutoff)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .slice(0, batchSize);
    if (old.length === 0) return 0;
    this.archived.push(...old);
    const oldIds = new Set(old.map((r) => r.id));
    this.rows = this.rows.filter((r) => !oldIds.has(r.id));
    return old.length;
  }

  async deleteArchivedOlderThan(cutoff: Date, batchSize: number): Promise<number> {
    // 模拟：archived 行存档时间假设等于其 created_at（stub 测试不区分）
    const before = this.archived.length;
    const remaining = this.archived.filter((r) => r.created_at >= cutoff);
    const trim = remaining.length + Math.min(before - remaining.length, batchSize);
    const removed = before - trim < 0 ? 0 : before - trim;
    // 简化：直接保留所有 created_at >= cutoff 的，删除最早 batchSize 个
    const expired = this.archived.filter((r) => r.created_at < cutoff).slice(0, batchSize);
    const ids = new Set(expired.map((e) => e.id));
    this.archived = this.archived.filter((r) => !ids.has(r.id));
    return expired.length;
  }
}

const ALL_ACTIONS: AuditAction[] = [
  'EMPLOYEE_CREATE',
  'EMPLOYEE_UPDATE',
  'EMPLOYEE_DELETE',
  'EMPLOYEE_UPDATE_ROLE',
  'PASSWORD_RESET',
  'PASSWORD_CHANGE',
  'ORDER_CHECKOUT',
  'ORDER_ADD_ITEM',
  'ORDER_REFUND',
  'MENU_ITEM_UPDATE',
  'PRINTER_CONFIG_UPDATE',
  'PRINTER_AUTO_PRINT_TOGGLE',
  'PRINTER_TEST',
  'PRINT_TEMPLATE_UPDATE',
  'EXPORT_ORDERS',
  'EXPORT_REPORT',
  'NOTIF_PREF_UPDATE',
];

const arbAction = fc.constantFrom(...ALL_ACTIONS);

// 任意 JSON-safe 值（深度 ≤ 4），可触发递归脱敏路径
const arbJsonValue = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', maxDepth: 4 },
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.string({ maxLength: 50 }),
    fc.array(tie('value') as fc.Arbitrary<unknown>, { maxLength: 5 }),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), tie('value') as fc.Arbitrary<unknown>, { maxKeys: 5 }),
  ),
})).value;

const arbAuditPayload = fc.record(
  {
    action: arbAction,
    targetType: fc.string({ minLength: 1, maxLength: 30 }),
    targetId: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
    before: fc.option(fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), arbJsonValue, { maxKeys: 6 }), { nil: undefined }),
    after: fc.option(fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), arbJsonValue, { maxKeys: 6 }), { nil: undefined }),
    meta: fc.option(fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), arbJsonValue, { maxKeys: 6 }), { nil: undefined }),
  },
  { requiredKeys: ['action', 'targetType', 'targetId'] },
) as fc.Arbitrary<AuditPayload>;

// ============================================================
// Property 7: 密码不泄漏到审计 payload
// ============================================================
describe('Feature: merchant-ops-center, Property 7: passwords never leak into audit payload', () => {
  it('redact() recursively masks any field whose name contains password/pwd/secret/token/...', () => {
    // 生成一个高复杂度密码（≥ 16 字符，混合大小写+数字+特殊字符），避免与上下文文本随机碰撞
    // 真实业务里密码至少 8 位，这里加大长度让"无碰撞"语义更准确
    const arbStrongPwd = fc
      .stringMatching(/^[A-Za-z0-9!@#$%^&*()_+=\-]{16,32}$/)
      .filter((s) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s));

    fc.assert(
      fc.property(
        arbStrongPwd,
        fc.constantFrom('password', 'pwd', 'newPassword', 'oldPassword', 'secret', 'token', 'apiKey', 'device_key', 'private_key'),
        (pwd, fieldName) => {
          // 多层嵌套 + 数组 + 多个敏感字段
          const payload: AuditPayload = {
            action: 'EMPLOYEE_CREATE',
            targetType: 'employee',
            targetId: '42',
            before: {
              user: {
                username: 'alice',
                [fieldName]: pwd,
                profile: {
                  nested_secret: pwd,
                  data: [{ pwd: pwd }, { authToken: pwd }],
                },
              },
            },
            after: {
              [fieldName]: pwd,
              normal_field: 'safe-value',
            },
            meta: { credentials: { password: pwd, secret: pwd } },
          };
          const { json } = AuditCore.serializePayload(payload);
          // 把明文密码替换成可见标记，便于失败时定位
          const parsed = JSON.parse(json);
          const flat = collectStringValues(parsed);
          // 不变量：JSON 中所有 string value 都不应包含明文密码
          return flat.every((s) => !s.includes(pwd));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('write() through Core never persists raw password to repo', async () => {
    const repo = new StubAuditRepo();
    const core = new AuditCore(repo);
    const actor: ActorContext = {
      userId: 1,
      role: 'owner',
      ip: '127.0.0.1',
      userAgent: 'jest',
      requestId: 'req-1',
    };

    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 8, maxLength: 32 }), async (pwd) => {
        repo.rows = [];
        await core.write(actor, {
          action: 'PASSWORD_CHANGE',
          targetType: 'employee',
          targetId: '1',
          before: { password: pwd, oldPassword: pwd },
          after: { password: pwd, newPassword: pwd, ok: true },
          meta: { reason: 'self_change' },
        });
        expect(repo.rows.length).toBe(1);
        const stored = repo.rows[0];
        // 整行 JSON 化扫描，确保绝不出现明文
        const allText = JSON.stringify(stored);
        return !allText.includes(pwd);
      }),
      { numRuns: 50 },
    );
  });
});

// 收集对象内所有 string 值的辅助函数
function collectStringValues(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(collectStringValues);
  if (typeof v === 'object') return Object.values(v).flatMap(collectStringValues);
  return [];
}

// ============================================================
// Property 8: serialize/deserialize round-trip + ≤ 8KB
// ============================================================
describe('Feature: merchant-ops-center, Property 8: audit JSON round-trip preserves canonicalized payload', () => {
  it('round-trip equivalence + size ≤ 8192 bytes', () => {
    fc.assert(
      fc.property(arbAuditPayload, (p) => {
        const { json, truncated } = AuditCore.serializePayload(p);
        // 不变量 1：序列化后字节数 ≤ 8192
        expect(json.length).toBeLessThanOrEqual(8192);
        // 不变量 2：JSON 自身可以解析回来
        const round = AuditCore.deserializePayload(json);
        // 不变量 3：关键字段保留（非字符串字段保持原值）
        expect(round.action).toBe(p.action);
        expect(round.targetType).toBe(p.targetType);
        expect(round.targetId).toBe(p.targetId);
        // 不变量 4：截断时 _truncated === true
        if (truncated) {
          expect(round._truncated).toBe(true);
        }
        // 不变量 5：未截断时与脱敏后版本深等
        if (!truncated) {
          expect(round).toEqual(AuditCore.redact(p));
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('intentionally oversized payload always truncates and stays ≤ 8192', () => {
    const huge = 'X'.repeat(20000);
    const p: AuditPayload = {
      action: 'ORDER_CHECKOUT',
      targetType: 'order',
      targetId: 'o-1',
      before: { dump: huge },
      after: { result: huge },
      meta: { extra: huge },
    };
    const { json, truncated } = AuditCore.serializePayload(p);
    expect(truncated).toBe(true);
    expect(json.length).toBeLessThanOrEqual(8192);
    const round = AuditCore.deserializePayload(json);
    expect(round.action).toBe('ORDER_CHECKOUT');
    expect(round.targetType).toBe('order');
    expect(round.targetId).toBe('o-1');
    expect(round._truncated).toBe(true);
  });
});

// ============================================================
// Property 9: validateRange — 接受 iff start<end ∧ end-start ≤ 90 天
// ============================================================
describe('Feature: merchant-ops-center, Property 9: audit query range constraint (≤ 90 days)', () => {
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

  it('accepts iff startAt < endAt AND endAt - startAt ≤ 90 days', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }),
        fc.integer({ min: -180 * 24 * 60 * 60 * 1000, max: 180 * 24 * 60 * 60 * 1000 }),
        (start, deltaMs) => {
          const end = new Date(start.getTime() + deltaMs);
          const result = AuditCore.validateRange(start, end);
          const valid = deltaMs > 0 && deltaMs <= NINETY_DAYS_MS;
          if (valid) return result.ok === true;
          return result.ok === false;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects equal timestamps', () => {
    const t = new Date();
    expect(AuditCore.validateRange(t, t)).toEqual({ ok: false, code: 'RANGE_INVALID' });
  });

  it('rejects exactly > 90 days with RANGE_TOO_LARGE', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date(start.getTime() + NINETY_DAYS_MS + 1);
    expect(AuditCore.validateRange(start, end)).toEqual({ ok: false, code: 'RANGE_TOO_LARGE' });
  });

  it('accepts exactly 90 days', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date(start.getTime() + NINETY_DAYS_MS);
    expect(AuditCore.validateRange(start, end)).toEqual({ ok: true });
  });

  it('rejects invalid Date inputs', () => {
    const t = new Date();
    expect(AuditCore.validateRange(new Date('invalid'), t).ok).toBe(false);
    expect(AuditCore.validateRange(t, new Date('invalid')).ok).toBe(false);
  });
});

// ============================================================
// Property 10: archive 划分正确
// ============================================================
describe('Feature: merchant-ops-center, Property 10: audit archive partitioning', () => {
  let repo: StubAuditRepo;
  let core: AuditCore;
  const ACTOR: ActorContext = {
    userId: 1,
    role: 'owner',
    ip: '127.0.0.1',
    userAgent: 'jest',
    requestId: '',
  };

  beforeEach(() => {
    repo = new StubAuditRepo();
    core = new AuditCore(repo);
  });

  it('post-archive: main ∪ archive == R, main only contains created_at >= now-180d', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 一组随机的"日龄"（距 now 多少天前），范围 -10 ~ 365，覆盖 cutoff 两侧
        fc.array(fc.integer({ min: -10, max: 365 }), { minLength: 0, maxLength: 50 }),
        async (ageDaysList) => {
          repo.rows = [];
          repo.archived = [];
          const now = new Date('2025-06-01T00:00:00Z');
          // 准备数据
          for (const age of ageDaysList) {
            const at = new Date(now.getTime() - age * 24 * 60 * 60 * 1000);
            // 直接塞入（绕过 core.write 以便控制 created_at）
            await repo.insert({
              actor_user_id: 1,
              actor_role: 'owner',
              action: 'ORDER_CHECKOUT',
              target_type: 'order',
              target_id: 'o-1',
              payload_json: '{}',
              ip_address: '127.0.0.1',
              user_agent: 'jest',
              created_at: at,
            });
          }
          const total = repo.rows.length;
          const result = await core.archive(now, 180, 5000, 200);

          // (a) 主表 ∪ 归档表 = R（按 id）
          const allIds = new Set([
            ...repo.rows.map((r) => r.id!),
            ...repo.archived.map((r) => r.id!),
          ]);
          expect(allIds.size).toBe(total);

          // (b) 主表只剩 created_at >= now - 180 天
          const cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
          for (const r of repo.rows) {
            expect(r.created_at.getTime() >= cutoff.getTime()).toBe(true);
          }
          // 归档表只含 created_at < cutoff
          for (const r of repo.archived) {
            expect(r.created_at.getTime() < cutoff.getTime()).toBe(true);
          }

          // 已迁移行数 = 归档表行数
          expect(result.totalMigrated).toBe(repo.archived.length);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('respects single-batch ≤ B (B=5000) per round', async () => {
    // 构造 7000 条都需要归档的记录，B=5000
    const now = new Date('2025-06-01T00:00:00Z');
    const past = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 7000; i++) {
      await repo.insert({
        actor_user_id: 1,
        actor_role: 'owner',
        action: 'ORDER_CHECKOUT',
        target_type: 'order',
        target_id: String(i),
        payload_json: '{}',
        ip_address: '127.0.0.1',
        user_agent: 'jest',
        created_at: past,
      });
    }
    // 把 archiveOlderThan 包装：每轮捕捉 batch size
    const realFn = repo.archiveOlderThan.bind(repo);
    const sizes: number[] = [];
    repo.archiveOlderThan = async (cutoff: Date, batchSize: number) => {
      const migrated = await realFn(cutoff, batchSize);
      sizes.push(migrated);
      return migrated;
    };
    const result = await core.archive(now, 180, 5000, 200);
    expect(result.totalMigrated).toBe(7000);
    // 每轮 ≤ 5000
    sizes.forEach((s) => expect(s).toBeLessThanOrEqual(5000));
    // 至少 2 轮
    expect(sizes.length).toBeGreaterThanOrEqual(2);
  });

  it('idempotent: running archive twice has no extra effect', async () => {
    const now = new Date('2025-06-01T00:00:00Z');
    // 一些老的 + 一些新的
    for (let i = 0; i < 100; i++) {
      const ageDays = i < 60 ? 200 : 30; // 60 老 40 新
      const at = new Date(now.getTime() - ageDays * 24 * 60 * 60 * 1000);
      await repo.insert({
        actor_user_id: 1,
        actor_role: 'owner',
        action: 'ORDER_CHECKOUT',
        target_type: 'order',
        target_id: String(i),
        payload_json: '{}',
        ip_address: '127.0.0.1',
        user_agent: 'jest',
        created_at: at,
      });
    }
    const r1 = await core.archive(now);
    expect(r1.totalMigrated).toBe(60);
    const r2 = await core.archive(now);
    expect(r2.totalMigrated).toBe(0);
    expect(repo.rows.length).toBe(40);
    expect(repo.archived.length).toBe(60);
  });

  // ============================================================
  // pruneArchive：归档表二级清理（防止归档表无限增长）
  // ============================================================
  it('pruneArchive removes old rows from archive table', async () => {
    const now = new Date('2025-06-01T00:00:00Z');
    // 直接插入归档表（绕过 archive，因为 stub archived_at = created_at）
    for (let i = 0; i < 50; i++) {
      const ageDays = i < 30 ? 400 : 100; // 30 行已经在归档 400 天，20 行 100 天
      const at = new Date(now.getTime() - ageDays * 24 * 60 * 60 * 1000);
      repo.archived.push({
        id: i + 1000,
        actor_user_id: 1,
        actor_role: 'owner',
        action: 'ORDER_CHECKOUT',
        target_type: 'order',
        target_id: String(i),
        payload_json: '{}',
        ip_address: '127.0.0.1',
        user_agent: 'jest',
        created_at: at,
      });
    }
    const result = await core.pruneArchive(now, 365);
    expect(result.totalPruned).toBe(30);
    expect(repo.archived.length).toBe(20);
  });
});
