/**
 * EmployeeCore：员工管理领域核心
 *
 * 这是一个纯业务规则类，不依赖任何 Nest 装饰器或 I/O；可在单元测试中直接 new 出来用 stub repo。
 *
 * 不变量（来自 design.md / requirements.md）：
 * - I1 至少 1 个 active owner（R3.1, R3.2）
 * - I2 active owner 数量 ≤ 5（R3.3）
 * - I3 不能自删 / 自降权（R4.1, R4.2）
 * - I4-I5 token_version 单调非降；删除/禁用/改密时 +1
 * - I6 密码不出现在审计 / 日志 / 响应（R6.6）
 *
 * 属性测试目标：
 * - Property 2: Owner 数量并发不变量
 * - Property 4: token_version 单调
 * - Property 5: 密码策略
 * - Property 6: 临时密码生成
 */
import * as bcrypt from 'bcryptjs';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  EmployeeRepoPort,
  EmployeeRow,
  EmployeeListFilter,
  PageOptions,
  Page,
  EmployeePatch,
} from './employee-repo.port';
import type { ActorContext, Role } from '../auth/rbac.types';
import { ASSIGNABLE_EMPLOYEE_ROLES } from '../auth/rbac.types';
import { isAllowed, PERMISSION_MATRIX } from '../auth/permission-matrix';
import type { AuditAction } from '../auth/rbac.types';

const BCRYPT_COST = 10;
const OWNER_LIMIT_MAX = 5;
const TEMP_PASSWORD_LENGTH = 12;

export interface CreateEmployeeDto {
  username: string;
  password: string;
  role: Role;
  nickname?: string;
}

export interface UpdateEmployeeDto {
  nickname?: string;
  role?: Role;
  status?: 'active' | 'disabled';
}

/**
 * EmployeeCore 选项：注入跨模块依赖
 */
export interface EmployeeCoreOpts {
  /** 强制下线钩子：在 token_version 变更后调用，断开该用户所有 WS */
  forceLogout?: (userId: number, reason?: string) => void;
}

@Injectable()
export class EmployeeCore {
  private readonly logger = new Logger(EmployeeCore.name);

  constructor(
    private readonly repo: EmployeeRepoPort,
    private readonly opts: EmployeeCoreOpts = {},
  ) {}

  // ============================================================
  // 静态规则（property test 直接调用）
  // ============================================================

  /**
   * I1 / I2：Owner 数量上下限
   * @param activeOwnerCountAfter 假定执行操作之后的 active owner 数量
   * @returns 'OK' | 错误代号
   */
  static checkOwnerInvariant(activeOwnerCountAfter: number):
    | { ok: true }
    | { ok: false; code: 'LAST_OWNER_PROTECTED' | 'OWNER_LIMIT_REACHED' }
  {
    if (activeOwnerCountAfter < 1) return { ok: false, code: 'LAST_OWNER_PROTECTED' };
    if (activeOwnerCountAfter > OWNER_LIMIT_MAX) return { ok: false, code: 'OWNER_LIMIT_REACHED' };
    return { ok: true };
  }

  /**
   * I3：自我操作约束（自删 / 自降权）
   * @returns 'OK' | 'SELF_DELETE_FORBIDDEN' | 'SELF_DEMOTE_FORBIDDEN'
   */
  static checkSelfActionRules(
    actorId: number,
    target: EmployeeRow,
    op: { type: 'delete' } | { type: 'update'; nextRole?: Role; nextStatus?: 'active' | 'disabled' },
  ): { ok: true } | { ok: false; code: 'SELF_DELETE_FORBIDDEN' | 'SELF_DEMOTE_FORBIDDEN' | 'SELF_DISABLE_FORBIDDEN' } {
    if (target.id !== actorId) return { ok: true };

    if (op.type === 'delete') return { ok: false, code: 'SELF_DELETE_FORBIDDEN' };

    // update 自身：禁止改 status（避免自禁用导致登录不了）
    if (op.nextStatus !== undefined && op.nextStatus !== 'active') {
      return { ok: false, code: 'SELF_DISABLE_FORBIDDEN' };
    }

    // update 自身角色：新 role 必须是当前 role 的超集或同等（按权限矩阵推导）
    if (op.nextRole !== undefined && op.nextRole !== target.role) {
      const currentPerms = EmployeeCore.permsOf(target.role);
      const nextPerms = EmployeeCore.permsOf(op.nextRole);
      // nextPerms ⊇ currentPerms 才算"非降权"
      for (const p of currentPerms) {
        if (!nextPerms.has(p)) return { ok: false, code: 'SELF_DEMOTE_FORBIDDEN' };
      }
    }
    return { ok: true };
  }

  /** 计算某个角色拥有的全部 AuditAction 集合（基于权限矩阵） */
  static permsOf(role: Role): Set<AuditAction> {
    const result = new Set<AuditAction>();
    for (const action in PERMISSION_MATRIX) {
      if (isAllowed(role, action as AuditAction)) {
        result.add(action as AuditAction);
      }
    }
    return result;
  }

  /**
   * I6 / R6.4：密码强度
   * 8-64 字符，含字母与数字
   */
  static checkPasswordPolicy(plain: string): { ok: true } | { ok: false; reason: string } {
    if (typeof plain !== 'string') return { ok: false, reason: '密码必须为字符串' };
    if (plain.length < 8 || plain.length > 64) return { ok: false, reason: '密码长度必须在 8~64 之间' };
    if (!/[a-zA-Z]/.test(plain)) return { ok: false, reason: '密码必须包含字母' };
    if (!/[0-9]/.test(plain)) return { ok: false, reason: '密码必须包含数字' };
    return { ok: true };
  }

  /**
   * R6.1：12 位临时密码生成
   * 仅 [A-Za-z0-9]，且至少含一个数字、一个字母（满足 password policy）
   */
  static genTempPassword(): string {
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // 去掉易混 0/O/1/I
    const digits = '23456789';
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
    const random = (n: number) => Math.floor(Math.random() * n);
    const arr: string[] = [];
    // 保证至少 1 数字 + 1 字母
    arr.push(digits[random(digits.length)]);
    arr.push(letters[random(letters.length)]);
    while (arr.length < TEMP_PASSWORD_LENGTH) {
      arr.push(charset[random(charset.length)]);
    }
    // 简单 Fisher-Yates 打乱
    for (let i = arr.length - 1; i > 0; i--) {
      const j = random(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.join('');
  }

  // ============================================================
  // 业务方法（async，依赖 repo）
  // ============================================================

  async create(actor: ActorContext, dto: CreateEmployeeDto): Promise<EmployeeRow> {
    if (!ASSIGNABLE_EMPLOYEE_ROLES.includes(dto.role)) {
      throw new BadRequestException({ code: 'ROLE_INVALID', msg: '角色非法' });
    }
    const policy = EmployeeCore.checkPasswordPolicy(dto.password);
    if (!policy.ok) {
      throw new BadRequestException({ code: 'PASSWORD_POLICY_FAILED', msg: policy.reason });
    }
    const existing = await this.repo.findByUsername(dto.username);
    if (existing) {
      throw new ConflictException({ code: 'USERNAME_TAKEN', msg: '用户名已被占用' });
    }
    // I2: 创建 owner 时检查上限
    if (dto.role === 'owner') {
      const cnt = await this.repo.countActiveOwners();
      const inv = EmployeeCore.checkOwnerInvariant(cnt + 1);
      if (!inv.ok) throw new ConflictException({ code: inv.code, msg: 'Owner 数量已达上限' });
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    return await this.repo.insert({
      username: dto.username,
      passwordHash,
      role: dto.role,
      nickname: dto.nickname ?? null,
      must_change_password: false,
    });
  }

  async update(actor: ActorContext, id: number, dto: UpdateEmployeeDto): Promise<EmployeeRow> {
    const target = await this.repo.findById(id);
    if (!target || target.status === 'deleted') {
      throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', msg: '员工不存在' });
    }
    // I3 自我操作约束
    const selfCheck = EmployeeCore.checkSelfActionRules(actor.userId, target, {
      type: 'update',
      nextRole: dto.role,
      nextStatus: dto.status,
    });
    if (!selfCheck.ok) throw new ConflictException({ code: selfCheck.code, msg: '不能对自己执行此操作' });

    // 改 role 时校验
    if (dto.role && !ASSIGNABLE_EMPLOYEE_ROLES.includes(dto.role)) {
      throw new BadRequestException({ code: 'ROLE_INVALID', msg: '角色非法' });
    }

    // I1 / I2: owner 上下限保护
    const willActiveOwnerDelta = (() => {
      const wasOwner = target.role === 'owner' && target.status === 'active';
      const willBeOwner = (dto.role ?? target.role) === 'owner' && (dto.status ?? target.status) === 'active';
      if (!wasOwner && willBeOwner) return 1;
      if (wasOwner && !willBeOwner) return -1;
      return 0;
    })();
    if (willActiveOwnerDelta !== 0) {
      const cnt = await this.repo.countActiveOwners();
      const inv = EmployeeCore.checkOwnerInvariant(cnt + willActiveOwnerDelta);
      if (!inv.ok) {
        throw new ConflictException({
          code: inv.code,
          msg: inv.code === 'LAST_OWNER_PROTECTED' ? '至少需要保留一个店主' : 'Owner 数量已达上限',
        });
      }
    }

    // 角色或 status 变更 → bump token_version 强制下线
    const bumpTokenVersion =
      (dto.role !== undefined && dto.role !== target.role) ||
      (dto.status !== undefined && dto.status !== target.status);

    const result = await this.repo.update(id, {
      nickname: dto.nickname,
      role: dto.role,
      status: dto.status,
      bumpTokenVersion,
    });
    if (bumpTokenVersion) {
      this.opts.forceLogout?.(id, 'employee profile changed');
    }
    return result;
  }

  async softDelete(actor: ActorContext, id: number): Promise<void> {
    const target = await this.repo.findById(id);
    if (!target || target.status === 'deleted') {
      throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', msg: '员工不存在' });
    }
    // I3 自删保护
    const selfCheck = EmployeeCore.checkSelfActionRules(actor.userId, target, { type: 'delete' });
    if (!selfCheck.ok) throw new ConflictException({ code: selfCheck.code, msg: '不能删除自己的账号' });

    // I1：删除 active owner 前检查
    if (target.role === 'owner' && target.status === 'active') {
      const cnt = await this.repo.countActiveOwners();
      const inv = EmployeeCore.checkOwnerInvariant(cnt - 1);
      if (!inv.ok) {
        throw new ConflictException({ code: inv.code, msg: '至少需要保留一个店主' });
      }
    }
    await this.repo.softDelete(id);
    this.opts.forceLogout?.(id, 'account deleted');
  }

  async resetPassword(actor: ActorContext, id: number): Promise<{ tempPassword: string }> {
    const target = await this.repo.findById(id);
    if (!target || target.status === 'deleted') {
      throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', msg: '员工不存在' });
    }
    // R6.5：重置自己的密码 → 用改密接口
    if (target.id === actor.userId) {
      throw new ConflictException({ code: 'USE_CHANGE_PASSWORD', msg: '请使用改密接口修改自己的密码' });
    }
    const tempPassword = EmployeeCore.genTempPassword();
    const hash = await bcrypt.hash(tempPassword, BCRYPT_COST);
    await this.repo.update(id, {
      passwordHash: hash,
      must_change_password: true,
      bumpTokenVersion: true,
    });
    this.opts.forceLogout?.(id, 'password reset');
    return { tempPassword };
  }

  async changeOwnPassword(actor: ActorContext, oldPassword: string, newPassword: string): Promise<void> {
    const me = await this.repo.findById(actor.userId);
    if (!me) throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', msg: '账号不存在' });

    const policy = EmployeeCore.checkPasswordPolicy(newPassword);
    if (!policy.ok) {
      throw new BadRequestException({ code: 'PASSWORD_POLICY_FAILED', msg: policy.reason });
    }
    // 验证旧密码
    const currentHash = await this.repo.getPasswordHashById(actor.userId);
    if (!currentHash) {
      throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', msg: '账号不存在' });
    }
    const ok = await bcrypt.compare(oldPassword, currentHash);
    if (!ok) {
      throw new ForbiddenException({ code: 'OLD_PASSWORD_INVALID', msg: '旧密码错误' });
    }
    if (oldPassword === newPassword) {
      throw new BadRequestException({ code: 'SAME_PASSWORD', msg: '新密码与旧密码不能相同' });
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.repo.update(actor.userId, {
      passwordHash: hash,
      must_change_password: false,
      bumpTokenVersion: true, // 改密 → 强制其他设备下线
    });
    this.opts.forceLogout?.(actor.userId, 'password changed');
  }

  async list(filter: EmployeeListFilter, page: PageOptions): Promise<Page<EmployeeRow>> {
    return await this.repo.list(filter, page);
  }

  async findById(id: number): Promise<EmployeeRow | null> {
    return await this.repo.findById(id);
  }
}
