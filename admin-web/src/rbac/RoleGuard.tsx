import { Navigate } from 'react-router-dom'
import type { Role } from './types'
import { useAuthStore } from '@/stores/auth'

/**
 * RoleGuard：路由级角色守卫
 * 用法：<Route element={<RoleGuard requiredRoles={['owner']}><EmployeeListPage /></RoleGuard>} />
 *
 * Validates: Requirements 1.8, 18.4
 */
export function RoleGuard({
  requiredRoles,
  children,
}: {
  requiredRoles: ReadonlyArray<Role>
  children: React.ReactNode
}) {
  const role = useAuthStore((s) => s.user?.role) as Role | undefined
  if (!role) return <Navigate to="/login" replace />
  // admin 兼容：admin 视为任何 owner/manager 能进的页面都能进
  if (!requiredRoles.includes(role) && role !== 'admin') {
    return <Navigate to="/forbidden" replace />
  }
  return <>{children}</>
}
