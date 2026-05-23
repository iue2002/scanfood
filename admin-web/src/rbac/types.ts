/**
 * RBAC 类型与权限矩阵镜像（与后端 server/src/modules/merchant-ops/auth/* 保持一致）
 *
 * 注意：前端权限判定仅用于 UI 显隐（按钮/菜单），不能替代后端鉴权；后端最终兜底。
 */

export type Role = 'owner' | 'manager' | 'cashier' | 'waiter' | 'admin' | 'customer';

export type AuditAction =
  // 员工管理
  | 'EMPLOYEE_CREATE'
  | 'EMPLOYEE_UPDATE'
  | 'EMPLOYEE_DELETE'
  | 'EMPLOYEE_UPDATE_ROLE'
  | 'PASSWORD_RESET'
  | 'PASSWORD_CHANGE'
  // 订单
  | 'ORDER_CHECKOUT'
  | 'ORDER_ADD_ITEM'
  | 'ORDER_REFUND'
  // 菜品
  | 'MENU_ITEM_UPDATE'
  // 打印
  | 'PRINTER_CONFIG_UPDATE'
  | 'PRINTER_AUTO_PRINT_TOGGLE'
  | 'PRINTER_TEST'
  | 'PRINT_TEMPLATE_UPDATE'
  // 导出
  | 'EXPORT_ORDERS'
  | 'EXPORT_REPORT'
  // 通知
  | 'NOTIF_PREF_UPDATE';

const OWNER_ONLY: ReadonlyArray<Role> = ['owner', 'admin'];
const OWNER_AND_MANAGER: ReadonlyArray<Role> = ['owner', 'manager', 'admin'];
const STAFF_WITH_CASHIER: ReadonlyArray<Role> = ['owner', 'manager', 'cashier', 'admin'];
const ALL_STAFF: ReadonlyArray<Role> = ['owner', 'manager', 'cashier', 'waiter', 'admin'];

export const PERMISSION_MATRIX: Readonly<Record<AuditAction, ReadonlyArray<Role>>> = {
  EMPLOYEE_CREATE: OWNER_ONLY,
  EMPLOYEE_UPDATE: OWNER_ONLY,
  EMPLOYEE_DELETE: OWNER_ONLY,
  EMPLOYEE_UPDATE_ROLE: OWNER_ONLY,
  PASSWORD_RESET: OWNER_ONLY,
  PASSWORD_CHANGE: ALL_STAFF,
  ORDER_CHECKOUT: STAFF_WITH_CASHIER,
  ORDER_ADD_ITEM: STAFF_WITH_CASHIER,
  ORDER_REFUND: OWNER_AND_MANAGER,
  MENU_ITEM_UPDATE: OWNER_AND_MANAGER,
  PRINTER_CONFIG_UPDATE: OWNER_AND_MANAGER,
  PRINTER_AUTO_PRINT_TOGGLE: OWNER_AND_MANAGER,
  PRINTER_TEST: OWNER_AND_MANAGER,
  PRINT_TEMPLATE_UPDATE: OWNER_AND_MANAGER,
  EXPORT_ORDERS: OWNER_AND_MANAGER,
  EXPORT_REPORT: OWNER_AND_MANAGER,
  NOTIF_PREF_UPDATE: ALL_STAFF,
}

export function isAllowed(role: Role | null | undefined, action: AuditAction): boolean {
  if (!role) return false
  const allowed = PERMISSION_MATRIX[action]
  return !!allowed && allowed.includes(role)
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: '店主',
  manager: '经理',
  cashier: '收银员',
  waiter: '服务员',
  admin: '管理员',
  customer: '顾客',
}

export const ASSIGNABLE_EMPLOYEE_ROLES: ReadonlyArray<Role> = ['owner', 'manager', 'cashier', 'waiter']
