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
  | 'USERNAME_CHANGE'
  // 订单
  | 'ORDER_READ'
  | 'ORDER_CHECKOUT'
  | 'ORDER_ADD_ITEM'
  | 'ORDER_MARK_SERVED'
  | 'ORDER_DELETE_DRAFT'
  | 'ORDER_REFUND'
  // 菜品
  | 'MENU_ITEM_UPDATE'
  // 桌台
  | 'TABLE_READ'
  | 'TABLE_UPDATE'
  | 'TABLE_QRCODE_GENERATE'
  // 退款
  | 'REFUND_READ'
  // 营业数据
  | 'STATISTICS_READ'
  // 店铺设置
  | 'STORE_SETTINGS_UPDATE'
  | 'STORE_SMTP_UPDATE'
  // 通知配置
  | 'NOTIF_ROBOT_UPDATE'
  | 'NOTIF_TEMPLATE_UPDATE'
  | 'NOTIF_EMAIL_TEST'
  // 打印
  | 'PRINTER_CONFIG_UPDATE'
  | 'PRINTER_AUTO_PRINT_TOGGLE'
  | 'PRINTER_TEST'
  | 'PRINT_TEMPLATE_UPDATE'
  | 'PRINT_PLAN_UPDATE'
  // 导出
  | 'EXPORT_ORDERS'
  | 'EXPORT_REPORT'
  // 通知偏好
  | 'NOTIF_PREF_UPDATE';

const OWNER_ONLY: ReadonlyArray<Role> = ['owner', 'admin']
const OWNER_AND_MANAGER: ReadonlyArray<Role> = ['owner', 'manager', 'admin']
const OWNER_MANAGER_CASHIER: ReadonlyArray<Role> = ['owner', 'manager', 'cashier', 'admin']
const ALL_STAFF: ReadonlyArray<Role> = ['owner', 'manager', 'cashier', 'waiter', 'admin']

export const PERMISSION_MATRIX: Readonly<Record<AuditAction, ReadonlyArray<Role>>> = {
  // 员工管理
  EMPLOYEE_CREATE: OWNER_ONLY,
  EMPLOYEE_UPDATE: OWNER_ONLY,
  EMPLOYEE_DELETE: OWNER_ONLY,
  EMPLOYEE_UPDATE_ROLE: OWNER_ONLY,
  PASSWORD_RESET: OWNER_ONLY,
  PASSWORD_CHANGE: ALL_STAFF,
  USERNAME_CHANGE: ALL_STAFF,
  // 订单
  ORDER_READ: ALL_STAFF,
  ORDER_CHECKOUT: OWNER_MANAGER_CASHIER,
  ORDER_ADD_ITEM: OWNER_MANAGER_CASHIER,
  ORDER_MARK_SERVED: ALL_STAFF,
  ORDER_DELETE_DRAFT: OWNER_MANAGER_CASHIER,
  ORDER_REFUND: OWNER_AND_MANAGER,
  // 菜品
  MENU_ITEM_UPDATE: OWNER_AND_MANAGER,
  // 桌台
  TABLE_READ: ALL_STAFF,
  TABLE_UPDATE: OWNER_AND_MANAGER,
  TABLE_QRCODE_GENERATE: OWNER_AND_MANAGER,
  // 退款 / 营业数据
  REFUND_READ: OWNER_AND_MANAGER,
  STATISTICS_READ: OWNER_ONLY,
  // 店铺 / 通知配置
  STORE_SETTINGS_UPDATE: OWNER_AND_MANAGER,
  STORE_SMTP_UPDATE: OWNER_AND_MANAGER,
  NOTIF_ROBOT_UPDATE: OWNER_AND_MANAGER,
  NOTIF_TEMPLATE_UPDATE: OWNER_AND_MANAGER,
  NOTIF_EMAIL_TEST: OWNER_AND_MANAGER,
  // 打印
  PRINTER_CONFIG_UPDATE: OWNER_AND_MANAGER,
  PRINTER_AUTO_PRINT_TOGGLE: OWNER_AND_MANAGER,
  PRINTER_TEST: OWNER_AND_MANAGER,
  PRINT_TEMPLATE_UPDATE: OWNER_AND_MANAGER,
  PRINT_PLAN_UPDATE: OWNER_AND_MANAGER,
  // 导出
  EXPORT_ORDERS: OWNER_ONLY,
  EXPORT_REPORT: OWNER_ONLY,
  // 通知偏好
  NOTIF_PREF_UPDATE: ALL_STAFF,
}

export function isAllowed(role: Role | null | undefined, action: AuditAction): boolean {
  if (!role) return false
  const allowed = PERMISSION_MATRIX[action]
  return !!allowed && allowed.includes(role)
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: '店主',
  manager: '店长',
  cashier: '收银员',
  waiter: '服务员',
  admin: '管理员',
  customer: '顾客',
}

export const ASSIGNABLE_EMPLOYEE_ROLES: ReadonlyArray<Role> = ['owner', 'manager', 'cashier', 'waiter']
