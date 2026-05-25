import type { AuditAction, Role } from './rbac.types';

/**
 * 服务端权限矩阵
 *
 * 角色分级（user 决策版）：
 * - waiter   服务员：仅能看订单 + 桌台看板（看不到菜品/退款/数据/员工/打印等管理项）
 * - cashier  收银员：waiter 全部 + 结账/加菜
 * - manager  店长（经理）：除"营业数据 + 员工/打印/导出/系统级"外，几乎全能
 * - owner    店主：全权限（含数据总览、数据统计、员工管理）
 * - admin    保留兼容：视为 owner 超集
 *
 * R1.3 启动期校验：所有挂 @Permissions 的路由必须在矩阵里有 entry。
 */

// 复用一个角色集合常量
const OWNER_ONLY: ReadonlySet<Role> = new Set<Role>(['owner', 'admin']);
const OWNER_AND_MANAGER: ReadonlySet<Role> = new Set<Role>(['owner', 'manager', 'admin']);
const OWNER_MANAGER_CASHIER: ReadonlySet<Role> = new Set<Role>(['owner', 'manager', 'cashier', 'admin']);
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
  // 改自己的用户名任何登录员工都允许（不含 customer）；要求验证当前密码 + 用户名唯一
  USERNAME_CHANGE: ALL_STAFF,

  // ====== 订单业务 ======
  // 结账/加菜：收银员及以上
  ORDER_CHECKOUT: OWNER_MANAGER_CASHIER,
  ORDER_ADD_ITEM: OWNER_MANAGER_CASHIER,
  // 退款：经理及以上（涉及钱）
  ORDER_REFUND: OWNER_AND_MANAGER,

  // ====== 菜品（经理及以上） ======
  MENU_ITEM_UPDATE: OWNER_AND_MANAGER,

  // ====== 打印（经理及以上） ======
  PRINTER_CONFIG_UPDATE: OWNER_AND_MANAGER,
  PRINTER_AUTO_PRINT_TOGGLE: OWNER_AND_MANAGER,
  PRINTER_TEST: OWNER_AND_MANAGER,
  PRINT_TEMPLATE_UPDATE: OWNER_AND_MANAGER,
  PRINT_PLAN_UPDATE: OWNER_AND_MANAGER,

  // ====== 导出（owner 专属：营业数据敏感） ======
  EXPORT_ORDERS: OWNER_ONLY,
  EXPORT_REPORT: OWNER_ONLY,

  // ====== 通知偏好（每个员工管自己的） ======
  NOTIF_PREF_UPDATE: ALL_STAFF,
};

/** 判断 role 是否可以执行 action */
export function isAllowed(role: Role | undefined | null, action: AuditAction): boolean {
  if (!role) return false;
  const allowed = PERMISSION_MATRIX[action];
  if (!allowed) return false;
  return allowed.has(role);
}
