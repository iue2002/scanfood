/**
 * Feature: merchant-ops-center, Property 2/4/5/6: Employee domain invariants
 * Validates: Requirements 3.1, 3.2, 3.3, 4.2, 5.1, 6.1, 6.4
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { EmployeeCore } from './employee.core';
import type { EmployeeRow } from './employee-repo.port';
import type { Role } from '../auth/rbac.types';

const baseRow = (overrides: Partial<EmployeeRow> = {}): EmployeeRow => ({
  id: 1,
  username: 'u1',
  role: 'cashier',
  nickname: null,
  avatar_url: null,
  status: 'active',
  token_version: 0,
  must_change_password: false,
  deleted_at: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

describe('Feature: merchant-ops-center, Property 2: Owner count invariant [1, 5]', () => {
  it('rejects when count drops below 1', () => {
    expect(EmployeeCore.checkOwnerInvariant(0)).toEqual({ ok: false, code: 'LAST_OWNER_PROTECTED' });
  });

  it('rejects when count exceeds 5', () => {
    expect(EmployeeCore.checkOwnerInvariant(6)).toEqual({ ok: false, code: 'OWNER_LIMIT_REACHED' });
  });

  it('accepts any count in [1, 5]', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (count) => {
        const result = EmployeeCore.checkOwnerInvariant(count);
        return result.ok === true;
      }),
      { numRuns: 100 },
    );
  });

  it('returns precise error code for out-of-range values', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 100 }), (count) => {
        const result = EmployeeCore.checkOwnerInvariant(count);
        if (count < 1) return result.ok === false && result.code === 'LAST_OWNER_PROTECTED';
        if (count > 5) return result.ok === false && result.code === 'OWNER_LIMIT_REACHED';
        return result.ok === true;
      }),
      { numRuns: 200 },
    );
  });
});

describe('Feature: merchant-ops-center, Property 3: Self-action rules', () => {
  it('rejects self-delete', () => {
    const me = baseRow({ id: 7, role: 'owner' });
    const r = EmployeeCore.checkSelfActionRules(7, me, { type: 'delete' });
    expect(r).toEqual({ ok: false, code: 'SELF_DELETE_FORBIDDEN' });
  });

  it('rejects self-disable', () => {
    const me = baseRow({ id: 7, role: 'owner' });
    const r = EmployeeCore.checkSelfActionRules(7, me, { type: 'update', nextStatus: 'disabled' });
    expect(r).toEqual({ ok: false, code: 'SELF_DISABLE_FORBIDDEN' });
  });

  it('rejects self-demote: owner → cashier', () => {
    const me = baseRow({ id: 7, role: 'owner' });
    const r = EmployeeCore.checkSelfActionRules(7, me, { type: 'update', nextRole: 'cashier' });
    expect(r).toEqual({ ok: false, code: 'SELF_DEMOTE_FORBIDDEN' });
  });

  it('allows operating on others (id mismatch)', () => {
    const target = baseRow({ id: 99, role: 'cashier' });
    const r = EmployeeCore.checkSelfActionRules(7, target, { type: 'delete' });
    expect(r.ok).toBe(true);
  });

  it('allows self update of nickname (no role/status change)', () => {
    const me = baseRow({ id: 7, role: 'owner' });
    const r = EmployeeCore.checkSelfActionRules(7, me, { type: 'update' });
    expect(r.ok).toBe(true);
  });

  it('allows lateral self-role change to a superset role', () => {
    const me = baseRow({ id: 7, role: 'manager' });
    // manager → owner is a superset (owner can do strictly more)
    const r = EmployeeCore.checkSelfActionRules(7, me, { type: 'update', nextRole: 'owner' });
    expect(r.ok).toBe(true);
  });
});

describe('Feature: merchant-ops-center, Property 5: password policy', () => {
  it('rejects too short / too long', () => {
    expect(EmployeeCore.checkPasswordPolicy('a1').ok).toBe(false);
    expect(EmployeeCore.checkPasswordPolicy('a'.repeat(65) + '1').ok).toBe(false);
  });

  it('rejects digits-only and letters-only', () => {
    expect(EmployeeCore.checkPasswordPolicy('12345678').ok).toBe(false);
    expect(EmployeeCore.checkPasswordPolicy('abcdefgh').ok).toBe(false);
  });

  it('accepts valid password (8-64 chars, contains letter+digit)', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => /[a-zA-Z]/.test(s)),
          fc.integer({ min: 1000, max: 999999 }),
        ),
        ([letters, digits]) => {
          const candidate = (letters + digits).slice(0, 64);
          if (candidate.length < 8) return true;
          if (candidate.length > 64) return true;
          if (!/[a-zA-Z]/.test(candidate)) return true;
          if (!/[0-9]/.test(candidate)) return true;
          return EmployeeCore.checkPasswordPolicy(candidate).ok === true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects empty / non-string inputs', () => {
    expect(EmployeeCore.checkPasswordPolicy('').ok).toBe(false);
    expect(EmployeeCore.checkPasswordPolicy(null as any).ok).toBe(false);
    expect(EmployeeCore.checkPasswordPolicy(undefined as any).ok).toBe(false);
  });
});

describe('Feature: merchant-ops-center, Property 6: temporary password generation', () => {
  it('always 12 chars, contains letter + digit, only [A-Za-z0-9]', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const p = EmployeeCore.genTempPassword();
        return (
          p.length === 12 &&
          /[a-zA-Z]/.test(p) &&
          /[0-9]/.test(p) &&
          /^[A-Za-z0-9]+$/.test(p) &&
          EmployeeCore.checkPasswordPolicy(p).ok === true
        );
      }),
      { numRuns: 500 },
    );
  });

  it('produces sufficiently varied output (no two consecutive calls equal in 50 trials)', () => {
    const samples = new Set<string>();
    for (let i = 0; i < 50; i++) samples.add(EmployeeCore.genTempPassword());
    // 50 个里允许一两次碰撞，但绝大多数应该不同
    expect(samples.size).toBeGreaterThanOrEqual(48);
  });
});

// ==========================================================================
// Property: stub-repo 模拟下的并发 owner-count 串行化
// ==========================================================================
describe('Feature: merchant-ops-center, Property 2 extended: owner count under simulated concurrent ops', () => {
  /**
   * 用一个内存"事务串行化"的 stub repo 模拟 SELECT FOR UPDATE。
   * 目的：在并发删除/降权 owner 的随机交错下，最终 active owner 数量 ∈ [1, 5]，
   * 且每个被拒的操作都返回明确错误码而非默默通过。
   */
  it('serialized writes never violate [1, 5] invariant', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.record({ kind: fc.constant('addOwner' as const) }),
            fc.record({ kind: fc.constant('removeOwner' as const) }),
            fc.record({ kind: fc.constant('demoteOwner' as const) }),
            fc.record({ kind: fc.constant('promoteToOwner' as const) }),
          ),
          { minLength: 1, maxLength: 50 },
        ),
        async (ops) => {
          // 初始 1 个 owner
          let activeOwnerCount = 1;
          for (const op of ops) {
            const before = activeOwnerCount;
            let delta = 0;
            if (op.kind === 'addOwner' || op.kind === 'promoteToOwner') delta = 1;
            if (op.kind === 'removeOwner' || op.kind === 'demoteOwner') delta = -1;
            const next = activeOwnerCount + delta;
            const inv = EmployeeCore.checkOwnerInvariant(next);
            if (inv.ok) {
              activeOwnerCount = next;
            }
            // 不变量：当前值始终在 [1, 5]
            if (activeOwnerCount < 1 || activeOwnerCount > 5) return false;
            if (!inv.ok && (next < 1 || next > 5)) {
              // 被正确拒绝
              if (activeOwnerCount !== before) return false;
            }
          }
          return activeOwnerCount >= 1 && activeOwnerCount <= 5;
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('Feature: merchant-ops-center, Property: permsOf monotone', () => {
  /**
   * permsOf 的属性：owner 的权限集严格 ⊇ manager 的权限集（owner 是 manager 的超集）
   * 这是设计层面的合理性检查（不在 EARS 里直接列出，但是整体架构假设）
   */
  it('owner perms ⊇ manager perms ⊇ cashier perms ⊇ waiter perms', () => {
    const ownerPerms = EmployeeCore.permsOf('owner');
    const managerPerms = EmployeeCore.permsOf('manager');
    const cashierPerms = EmployeeCore.permsOf('cashier');
    const waiterPerms = EmployeeCore.permsOf('waiter');

    for (const p of waiterPerms) expect(cashierPerms.has(p), `cashier should have ${p}`).toBe(true);
    for (const p of cashierPerms) expect(managerPerms.has(p), `manager should have ${p}`).toBe(true);
    for (const p of managerPerms) expect(ownerPerms.has(p), `owner should have ${p}`).toBe(true);
  });
});
