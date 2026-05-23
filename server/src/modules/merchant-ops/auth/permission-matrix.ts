import type { AuditAction, Role } from './rbac.types';

/**
 * 服务端权限矩阵
 *
 * 设计原则（来自 design.md 与 requirements.md R1）：
 * - key = AuditAction（与挂在 controller 上的 @Permissions(action) 一致）
 * - value = 允许执行该动作的角色集合
 * - admin 角色作为 owner 的超集（既有兼容），凡是 owner 能做的，admin 都能做
 *
 * R1.3 启动期校验：所有挂 @Permissions 的路由必须在矩阵里有 entry。
 * 见 auth-core 的 validateMatrixCoverage。
 */

// 复用一个角色集合常量，减少重复
const OWNER_ONLY: ReadonlySet<Role> = new Set<Role>(['owner', 'admin']);
const OWNER_AND_MANAGER: ReadonlySet<Role> = new Set<Role>(['owner', 'manager', 'admin']);
const STAFF_WITH_CASHIER: ReadonlySet<Role> = new Set<Role>(['owner', 'manager', 'cashier', 'admin']);
const ALL_STAFF: ReadonlySet<Role> = new Set<Role>(['owner', 'manager', 'cashier', 'waiter', 'admin']);

export type PermissionMatrix = Readonly<Record<AuditAction, ReadonlySet<Role>>>;

export const PERMISSION_MATRIX: PermissionMatrix = {
  // ====== 员工管理（owner 专属，R2.7） ======
  EMPLOYEE_CREATE: OWNER_ONLY,
  EMPLOYEE_UPDATE: OWNER_ONLY,
  EMPLOYEE_DELETE: OWNER_ONLY,
  EMPLOYEE_UPDATE_ROLE: OWNER_ONLY,
  PASSWORD_RESET: OWNER_ONLY,
  // 改自己的密码任何登录员工都允许（不含 customer）
  PASSWORD_CHANGE: ALL_STAFF,

  // ====== 订单业务（M1 不强制） ======
  ORDER_CHECKOUT: STAFF_WITH_CASHIER,
  ORDER_ADD_ITEM: STAFF_WITH_CASHIER,
  ORDER_REFUND: OWNER_AND_MANAGER,

  // ====== 菜品 ======
  MENU_ITEM_UPDATE: OWNER_AND_MANAGER,

  // ====== 打印（M5） ======
  PRINTER_CONFIG_UPDATE: OWNER_AND_MANAGER,
  PRINTER_AUTO_PRINT_TOGGLE: OWNER_AND_MANAGER,
  PRINTER_TEST: OWNER_AND_MANAGER,
  PRINT_TEMPLATE_UPDATE: OWNER_AND_MANAGER,

  // ====== 导出（M4） ======
  EXPORT_ORDERS: OWNER_AND_MANAGER,
  EXPORT_REPORT: OWNER_AND_MANAGER,

  // ====== 通知偏好（M3） ======
  NOTIF_PREF_UPDATE: ALL_STAFF,
};

/** 判断 role 是否可以执行 action */
export function isAllowed(role: Role | undefined | null, action: AuditAction): boolean {
  if (!role) return false;
  const allowed = PERMISSION_MATRIX[action];
  if (!allowed) return false;
  return allowed.has(role);
}
