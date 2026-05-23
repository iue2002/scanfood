/**
 * Feature: merchant-ops-center, Property 4: token_version monotone non-decreasing
 * Validates: Requirements 2.5, 5.1, 5.2, 5.3, 5.4, 6.4
 *
 * 性质：在任意 EmployeeCore 操作序列中，员工的 token_version 单调非降；
 *      并且在敏感操作（softDelete / disable / resetPassword / changeOwnPassword）后严格 +1。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { EmployeeCore } from './employee.core';
import type {
  EmployeeRepoPort,
  EmployeeRow,
  EmployeeListFilter,
  PageOptions,
  Page,
  NewEmployee,
  EmployeePatch,
} from './employee-repo.port';
import type { Role } from '../auth/rbac.types';

// 简易内存 repo：模拟事务串行化（同步实现）
class InMemoryEmployeeRepo implements EmployeeRepoPort {
  private rows = new Map<number, EmployeeRow>();
  private nextId = 1;
  // 记录每个 user 的 password hash（unit test 中用明文模拟 hash）
  private passwords = new Map<number, string>();

  seed(rows: EmployeeRow[], passwords: Record<number, string> = {}) {
    for (const r of rows) {
      this.rows.set(r.id, { ...r });
      if (r.id >= this.nextId) this.nextId = r.id + 1;
    }
    for (const id in passwords) this.passwords.set(Number(id), passwords[id]);
  }

  async countActiveOwners(): Promise<number> {
    let c = 0;
    for (const r of this.rows.values()) {
      if (r.role === 'owner' && r.status === 'active') c++;
    }
    return c;
  }
  async findByUsername(username: string): Promise<EmployeeRow | null> {
    for (const r of this.rows.values()) {
      if (r.username === username && r.status !== 'deleted') return { ...r };
    }
    return null;
  }
  async findById(id: number): Promise<EmployeeRow | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async getPasswordHashById(id: number): Promise<string | null> {
    return this.passwords.get(id) ?? null;
  }
  async insert(dto: NewEmployee): Promise<EmployeeRow> {
    const id = this.nextId++;
    const row: EmployeeRow = {
      id,
      username: dto.username,
      role: dto.role,
      nickname: dto.nickname ?? null,
      avatar_url: null,
      status: 'active',
      token_version: 0,
      must_change_password: dto.must_change_password ?? false,
      deleted_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    this.rows.set(id, row);
    this.passwords.set(id, dto.passwordHash);
    return { ...row };
  }
  async update(id: number, patch: EmployeePatch): Promise<EmployeeRow> {
    const r = this.rows.get(id);
    if (!r) throw new Error('row not found: ' + id);
    if (patch.nickname !== undefined) r.nickname = patch.nickname;
    if (patch.role !== undefined) r.role = patch.role;
    if (patch.status !== undefined) r.status = patch.status;
    if (patch.must_change_password !== undefined) r.must_change_password = patch.must_change_password;
    if (patch.passwordHash !== undefined) {
      this.passwords.set(id, patch.passwordHash);
    }
    if (patch.bumpTokenVersion) r.token_version += 1;
    r.updated_at = new Date();
    return { ...r };
  }
  async softDelete(id: number): Promise<EmployeeRow> {
    const r = this.rows.get(id);
    if (!r) throw new Error('row not found: ' + id);
    r.status = 'deleted';
    r.deleted_at = new Date();
    r.token_version += 1;
    return { ...r };
  }
  async list(filter: EmployeeListFilter, page: PageOptions): Promise<Page<EmployeeRow>> {
    const arr = [...this.rows.values()].filter((r) => {
      if (!filter.includeDeleted && r.status === 'deleted') return false;
      if (filter.role && r.role !== filter.role) return false;
      if (filter.status && r.status !== filter.status) return false;
      if (filter.username && !r.username.includes(filter.username)) return false;
      return true;
    });
    return { data: arr, total: arr.length, page: page.page, pageSize: page.pageSize };
  }
  async bumpTokenVersion(id: number): Promise<number> {
    const r = this.rows.get(id);
    if (!r) throw new Error('row not found: ' + id);
    r.token_version += 1;
    return r.token_version;
  }
}

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

describe('Feature: merchant-ops-center, Property 4: token_version monotone non-decreasing', () => {
  it('softDelete strictly increments token_version by 1', async () => {
    const repo = new InMemoryEmployeeRepo();
    repo.seed([
      baseRow({ id: 1, username: 'owner1', role: 'owner', status: 'active', token_version: 5 }),
      baseRow({ id: 2, username: 'cashier1', role: 'cashier', status: 'active', token_version: 5 }),
    ]);
    const core = new EmployeeCore(repo);
    await core.softDelete(
      { userId: 1, role: 'owner', ip: '1', userAgent: 'ua', requestId: 'r' },
      2,
    );
    const row = await repo.findById(2);
    expect(row?.token_version).toBe(6);
    expect(row?.status).toBe('deleted');
  });

  it('disabling user bumps token_version', async () => {
    const repo = new InMemoryEmployeeRepo();
    repo.seed([
      baseRow({ id: 1, username: 'owner1', role: 'owner', status: 'active', token_version: 0 }),
      baseRow({ id: 2, username: 'c1', role: 'cashier', status: 'active', token_version: 7 }),
    ]);
    const core = new EmployeeCore(repo);
    await core.update(
      { userId: 1, role: 'owner', ip: '1', userAgent: 'ua', requestId: 'r' },
      2,
      { status: 'disabled' },
    );
    const row = await repo.findById(2);
    expect(row?.token_version).toBe(8);
  });

  it('updating only nickname does NOT bump token_version', async () => {
    const repo = new InMemoryEmployeeRepo();
    repo.seed([
      baseRow({ id: 1, username: 'owner1', role: 'owner', status: 'active', token_version: 0 }),
      baseRow({ id: 2, username: 'c1', role: 'cashier', status: 'active', token_version: 3 }),
    ]);
    const core = new EmployeeCore(repo);
    await core.update(
      { userId: 1, role: 'owner', ip: '1', userAgent: 'ua', requestId: 'r' },
      2,
      { nickname: '小张' },
    );
    const row = await repo.findById(2);
    expect(row?.token_version).toBe(3);
    expect(row?.nickname).toBe('小张');
  });

  it('over a sequence of mixed operations, token_version is monotone non-decreasing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.record({ kind: fc.constant('updateNick' as const) }),
            fc.record({ kind: fc.constant('disable' as const) }),
            fc.record({ kind: fc.constant('reEnable' as const) }),
            fc.record({ kind: fc.constant('changeRole' as const) }),
          ),
          { minLength: 1, maxLength: 10 },
        ),
        async (ops) => {
          const repo = new InMemoryEmployeeRepo();
          repo.seed([
            baseRow({ id: 1, username: 'owner1', role: 'owner', status: 'active', token_version: 0 }),
            baseRow({ id: 99, username: 'target', role: 'cashier', status: 'active', token_version: 0 }),
          ]);
          const core = new EmployeeCore(repo);
          let lastVersion = 0;
          for (const op of ops) {
            try {
              if (op.kind === 'updateNick') {
                await core.update(
                  { userId: 1, role: 'owner', ip: '1', userAgent: 'ua', requestId: 'r' },
                  99,
                  { nickname: 'name-' + Math.random().toString(36).slice(2, 6) },
                );
              } else if (op.kind === 'disable') {
                await core.update(
                  { userId: 1, role: 'owner', ip: '1', userAgent: 'ua', requestId: 'r' },
                  99,
                  { status: 'disabled' },
                );
              } else if (op.kind === 'reEnable') {
                await core.update(
                  { userId: 1, role: 'owner', ip: '1', userAgent: 'ua', requestId: 'r' },
                  99,
                  { status: 'active' },
                );
              } else if (op.kind === 'changeRole') {
                const next: Role = Math.random() < 0.5 ? 'manager' : 'waiter';
                await core.update(
                  { userId: 1, role: 'owner', ip: '1', userAgent: 'ua', requestId: 'r' },
                  99,
                  { role: next },
                );
              }
            } catch {
              /* 被拒绝的操作不应改变 token_version */
            }
            const row = await repo.findById(99);
            const v = row?.token_version ?? 0;
            if (v < lastVersion) return false;
            lastVersion = v;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
