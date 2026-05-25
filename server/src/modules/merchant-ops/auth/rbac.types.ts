/**
 * RBAC 类型定义：merchant-ops-center 模块的角色与审计动作
 * 严格按 design.md 第 3.1 节"通用类型"定义
 */

// ====== 角色 ======
// owner    店主：全权限
// manager  经理：除员工/角色管理外的全部
// cashier  收银员：结账 + 加菜 + 看订单 + 看桌台
// waiter   服务员：上菜 + 看桌台
// admin    保留：兼容既有 admin 账号（视为 owner 超集，向后兼容）
// customer 保留：小程序顾客
export type Role = 'owner' | 'manager' | 'cashier' | 'waiter' | 'admin' | 'customer';

export const ALL_ROLES: ReadonlyArray<Role> = ['owner', 'manager', 'cashier', 'waiter', 'admin', 'customer'];

// 员工可分配的角色集合（不含 customer / admin）
// admin 仅作为既有数据兼容值，新建员工不允许使用
export const ASSIGNABLE_EMPLOYEE_ROLES: ReadonlyArray<Role> = ['owner', 'manager', 'cashier', 'waiter'];

// ====== 审计动作 ======
// key 与权限矩阵 entry 一一对应；每个挂 @Permissions(action) 的路由都必须在 PERMISSION_MATRIX 中有 entry
export type AuditAction =
  // 员工管理
  | 'EMPLOYEE_CREATE'
  | 'EMPLOYEE_UPDATE'
  | 'EMPLOYEE_DELETE'
  | 'EMPLOYEE_UPDATE_ROLE'
  | 'PASSWORD_RESET'
  | 'PASSWORD_CHANGE'
  | 'USERNAME_CHANGE'
  // 订单（既有业务，挂 @Audit 即可，不强制权限）
  | 'ORDER_CHECKOUT'
  | 'ORDER_ADD_ITEM'
  | 'ORDER_REFUND'
  // 菜品
  | 'MENU_ITEM_UPDATE'
  // 打印（M5）
  | 'PRINTER_CONFIG_UPDATE'
  | 'PRINTER_AUTO_PRINT_TOGGLE'
  | 'PRINTER_TEST'
  | 'PRINT_TEMPLATE_UPDATE'
  | 'PRINT_PLAN_UPDATE'
  // 导出（M4）
  | 'EXPORT_ORDERS'
  | 'EXPORT_REPORT'
  // 通知偏好（M3）
  | 'NOTIF_PREF_UPDATE';

export const ALL_AUDIT_ACTIONS: ReadonlyArray<AuditAction> = [
  'EMPLOYEE_CREATE', 'EMPLOYEE_UPDATE', 'EMPLOYEE_DELETE', 'EMPLOYEE_UPDATE_ROLE',
  'PASSWORD_RESET', 'PASSWORD_CHANGE', 'USERNAME_CHANGE',
  'ORDER_CHECKOUT', 'ORDER_ADD_ITEM', 'ORDER_REFUND',
  'MENU_ITEM_UPDATE',
  'PRINTER_CONFIG_UPDATE', 'PRINTER_AUTO_PRINT_TOGGLE', 'PRINTER_TEST', 'PRINT_TEMPLATE_UPDATE', 'PRINT_PLAN_UPDATE',
  'EXPORT_ORDERS', 'EXPORT_REPORT',
  'NOTIF_PREF_UPDATE',
];

// ====== 调用者上下文 ======
export interface ActorContext {
  userId: number;
  role: Role;
  ip: string;
  userAgent: string;
  requestId: string;
}

// ====== 审计 payload ======
export interface AuditPayload {
  action: AuditAction;
  targetType: string;
  targetId: string | null;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  _truncated?: boolean;
}
