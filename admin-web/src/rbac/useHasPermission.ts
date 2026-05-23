import { useAuthStore } from '@/stores/auth'
import { isAllowed } from './types'
import type { AuditAction, Role } from './types'

/**
 * useHasPermission：判断当前登录用户是否有权执行某个 AuditAction
 * 用于按钮/菜单显隐；后端最终兜底
 *
 * Validates: Requirements 1.7
 */
export function useHasPermission(action: AuditAction): boolean {
  const role = useAuthStore((s) => s.user?.role) as Role | undefined
  return isAllowed(role, action)
}

/**
 * useHasAnyRole：判断当前用户是否属于给定的角色集合
 */
export function useHasAnyRole(...roles: Role[]): boolean {
  const role = useAuthStore((s) => s.user?.role) as Role | undefined
  if (!role) return false
  return roles.includes(role)
}

/**
 * useCurrentRole：直接返回当前用户角色
 */
export function useCurrentRole(): Role | null {
  const role = useAuthStore((s) => s.user?.role) as Role | undefined
  return role ?? null
}
