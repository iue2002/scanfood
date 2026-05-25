import { Injectable } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { users, user_preferences } from '@/storage/database/shared/schema';
import { and, eq, ne, like, sql, desc } from 'drizzle-orm';
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

/**
 * Drizzle 实现：基于既有 users 表 + M1 新增列做 CRUD
 *
 * 重要：
 * - 既有 customer 角色的微信顾客数据不进入员工列表
 * - 软删除走 status='deleted' + deleted_at；JWT 校验通过 token_version 自然失效
 */
@Injectable()
export class DrizzleEmployeeRepo implements EmployeeRepoPort {
  // 员工角色集合：customer 不算员工；admin 是历史兼容值
  private readonly EMPLOYEE_ROLES: Role[] = ['owner', 'manager', 'cashier', 'waiter', 'admin'];

  private mapRow(r: any): EmployeeRow {
    return {
      id: r.id,
      username: r.username,
      role: r.role as Role,
      nickname: r.nickname ?? null,
      avatar_url: r.avatar_url ?? null,
      status: (r.status ?? 'active') as 'active' | 'disabled' | 'deleted',
      token_version: r.token_version ?? 0,
      must_change_password: !!r.must_change_password,
      deleted_at: r.deleted_at ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  async countActiveOwners(): Promise<number> {
    const rows = await db.select({ c: sql<number>`count(*)` }).from(users)
      .where(and(
        eq(users.role, 'owner'),
        eq(users.status, 'active'),
      ));
    return Number(rows[0]?.c ?? 0);
  }

  async findByUsername(username: string): Promise<EmployeeRow | null> {
    const rows = await db.select().from(users)
      .where(and(eq(users.username, username), ne(users.status, 'deleted')))
      .limit(1);
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async findById(id: number): Promise<EmployeeRow | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async getPasswordHashById(id: number): Promise<string | null> {
    const rows = await db.select({ password: users.password }).from(users).where(eq(users.id, id)).limit(1);
    return rows[0]?.password ?? null;
  }

  async insert(dto: NewEmployee): Promise<EmployeeRow> {
    const insertResult = await db.insert(users).values({
      username: dto.username,
      password: dto.passwordHash,
      role: dto.role,
      nickname: dto.nickname ?? null,
      status: 'active',
      token_version: 0,
      must_change_password: dto.must_change_password ?? false,
    });
    const insertId = (insertResult as any)[0].insertId;
    const row = await this.findById(insertId);
    if (!row) throw new Error('insert succeeded but row not found');
    return row;
  }

  async update(id: number, patch: EmployeePatch): Promise<EmployeeRow> {
    const update: any = {};
    if (patch.username !== undefined) update.username = patch.username;
    if (patch.nickname !== undefined) update.nickname = patch.nickname;
    if (patch.role !== undefined) update.role = patch.role;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.passwordHash !== undefined) update.password = patch.passwordHash;
    if (patch.must_change_password !== undefined) update.must_change_password = patch.must_change_password;
    if (patch.bumpTokenVersion) {
      update.token_version = sql`${users.token_version} + 1`;
    }
    update.updated_at = new Date();

    if (Object.keys(update).length > 0) {
      await db.update(users).set(update).where(eq(users.id, id));
    }
    const row = await this.findById(id);
    if (!row) throw new Error('update succeeded but row not found');
    return row;
  }

  async softDelete(id: number): Promise<EmployeeRow> {
    await db.update(users).set({
      status: 'deleted',
      deleted_at: new Date(),
      token_version: sql`${users.token_version} + 1`,
      updated_at: new Date(),
    }).where(eq(users.id, id));
    // 级联清理：员工被软删后通知偏好不再有意义
    // user_preferences 的 user_id FK 是 ON DELETE CASCADE，但软删不会触发 cascade，要手动
    try {
      await db.delete(user_preferences).where(eq(user_preferences.user_id, id));
    } catch { /* 静默：清理失败不阻塞软删主流程 */ }
    const row = await this.findById(id);
    if (!row) throw new Error('soft delete succeeded but row not found');
    return row;
  }

  async list(filter: EmployeeListFilter, page: PageOptions): Promise<Page<EmployeeRow>> {
    const conditions: any[] = [];
    // 默认排除 customer
    conditions.push(sql`${users.role} IN ('owner','manager','cashier','waiter','admin')`);
    if (!filter.includeDeleted) {
      conditions.push(ne(users.status, 'deleted'));
    }
    if (filter.role) conditions.push(eq(users.role, filter.role));
    if (filter.status) conditions.push(eq(users.status, filter.status));
    if (filter.username) conditions.push(like(users.username, `%${filter.username}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const totalRows = await db.select({ c: sql<number>`count(*)` }).from(users).where(where as any);
    const total = Number(totalRows[0]?.c ?? 0);

    const offset = Math.max(0, (page.page - 1) * page.pageSize);
    const rows = await db.select().from(users).where(where as any)
      .orderBy(desc(users.created_at))
      .limit(page.pageSize)
      .offset(offset);

    return {
      data: rows.map(r => this.mapRow(r)),
      total,
      page: page.page,
      pageSize: page.pageSize,
    };
  }

  async bumpTokenVersion(id: number): Promise<number> {
    await db.update(users).set({
      token_version: sql`${users.token_version} + 1`,
      updated_at: new Date(),
    }).where(eq(users.id, id));
    const row = await this.findById(id);
    return row?.token_version ?? 0;
  }
}
