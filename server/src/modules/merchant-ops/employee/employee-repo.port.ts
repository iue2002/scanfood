/**
 * EmployeeRepoPort
 * 员工 CRUD 的持久化端口接口。具体实现见 employee-repo.drizzle.ts
 */
import type { Role } from '../auth/rbac.types';

export interface EmployeeRow {
  id: number;
  username: string;
  role: Role;
  nickname: string | null;
  avatar_url: string | null;
  status: 'active' | 'disabled' | 'deleted';
  token_version: number;
  must_change_password: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface EmployeeListFilter {
  role?: Role;
  status?: 'active' | 'disabled' | 'deleted';
  username?: string;
  /** 是否包含已删除：默认 false（视图里不显示） */
  includeDeleted?: boolean;
}

export interface PageOptions {
  page: number;
  pageSize: 10 | 20 | 50;
}

export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NewEmployee {
  username: string;
  passwordHash: string;
  role: Role;
  nickname?: string | null;
  must_change_password?: boolean;
}

export interface EmployeePatch {
  nickname?: string | null;
  role?: Role;
  status?: 'active' | 'disabled';
  passwordHash?: string;
  must_change_password?: boolean;
  bumpTokenVersion?: boolean;
}

/**
 * 端口接口：所有员工域 DB 操作的入口
 * Adapter 实现需要注意：
 * - countActiveOwnersForUpdate 必须使用 SELECT ... FOR UPDATE 行锁
 * - softDelete 必须在同一事务内 +1 token_version
 */
export interface EmployeeRepoPort {
  countActiveOwners(): Promise<number>;
  findByUsername(username: string): Promise<EmployeeRow | null>;
  findById(id: number): Promise<EmployeeRow | null>;
  insert(dto: NewEmployee): Promise<EmployeeRow>;
  update(id: number, patch: EmployeePatch): Promise<EmployeeRow>;
  /** 软删除：status='deleted', deleted_at=now(), token_version+=1 */
  softDelete(id: number): Promise<EmployeeRow>;
  list(filter: EmployeeListFilter, page: PageOptions): Promise<Page<EmployeeRow>>;
  bumpTokenVersion(id: number): Promise<number>;
}
