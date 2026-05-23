import { NavLink } from 'react-router-dom'
import {
  LayoutGrid,
  LayoutDashboard,
  Armchair,
  ClipboardList,
  UtensilsCrossed,
  RotateCcw,
  BarChart3,
  Settings,
  Users,
  ScrollText,
  Bell,
  Download,
  X,
} from 'lucide-react'
import { useUnread } from './UnreadProvider'
import Badge from './Badge'
import { useAuthStore } from '@/stores/auth'
import type { Role } from '@/rbac/types'

const menuItems = [
  // 全员可见
  { path: '/', label: '桌台看板', icon: LayoutGrid, badgeKey: null as null | 'orders' | 'refunds', visibleFor: null as null | ReadonlyArray<Role> },
  { path: '/orders', label: '订单管理', icon: ClipboardList, badgeKey: 'orders' as const, visibleFor: null },
  // 经理及以上
  { path: '/tables', label: '桌台管理', icon: Armchair, badgeKey: null, visibleFor: ['owner', 'manager', 'admin'] as ReadonlyArray<Role> },
  { path: '/dishes', label: '菜品管理', icon: UtensilsCrossed, badgeKey: null, visibleFor: ['owner', 'manager', 'admin'] as ReadonlyArray<Role> },
  { path: '/refunds', label: '退款售后', icon: RotateCcw, badgeKey: 'refunds' as const, visibleFor: ['owner', 'manager', 'admin'] as ReadonlyArray<Role> },
  { path: '/store-settings', label: '店铺设置', icon: Settings, badgeKey: null, visibleFor: ['owner', 'manager', 'admin'] as ReadonlyArray<Role> },
  // 仅店主 / 管理员
  { path: '/dashboard', label: '数据总览', icon: LayoutDashboard, badgeKey: null, visibleFor: ['owner', 'admin'] as ReadonlyArray<Role> },
  { path: '/statistics', label: '数据统计', icon: BarChart3, badgeKey: null, visibleFor: ['owner', 'admin'] as ReadonlyArray<Role> },
  { path: '/employees', label: '员工管理', icon: Users, badgeKey: null, visibleFor: ['owner', 'admin'] as ReadonlyArray<Role> },
  { path: '/data-export', label: '数据导出', icon: Download, badgeKey: null, visibleFor: ['owner', 'admin'] as ReadonlyArray<Role> },
  // 店主 + 店长（owner / manager / admin）
  { path: '/audit-logs', label: '审计日志', icon: ScrollText, badgeKey: null, visibleFor: ['owner', 'manager', 'admin'] as ReadonlyArray<Role> },
  // 全员可见（个人级）
  { path: '/notif-settings', label: '通知偏好', icon: Bell, badgeKey: null, visibleFor: null as null | ReadonlyArray<Role> },
]

interface SidebarProps {
  open?: boolean
  onClose?: () => void
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const { ordersUnread, refundsUnread } = useUnread()
  const role = useAuthStore((s) => s.user?.role) as Role | undefined

  const getBadgeCount = (key: null | 'orders' | 'refunds') => {
    if (key === 'orders') return ordersUnread
    if (key === 'refunds') return refundsUnread
    return 0
  }

  // 按当前角色过滤菜单（visibleFor=null 表示所有员工可见）
  const visibleMenuItems = menuItems.filter((item) => {
    if (!item.visibleFor) return true
    if (!role) return false
    return item.visibleFor.includes(role)
  })

  return (
    <aside
      className={`fixed left-0 top-0 h-full w-56 lg:w-64 bg-white border-r border-gray-200 z-50 flex flex-col transition-transform lg:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="h-14 lg:h-16 flex items-center justify-between px-4 lg:px-6 border-b border-gray-100">
        <div className="flex items-center">
          <div className="w-7 h-7 lg:w-8 lg:h-8 bg-[#2563EB] rounded-lg flex items-center justify-center mr-2 lg:mr-3">
            <UtensilsCrossed size={16} md:size={18} className="text-white" />
          </div>
          <span className="text-base lg:text-lg font-semibold text-[#0F172A]">扫码点餐</span>
        </div>
        <button onClick={onClose} className="lg:hidden p-1 text-[#94A3B8] hover:text-[#0F172A] cursor-pointer">
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 py-3 lg:py-4 px-2 lg:px-3 space-y-0.5 lg:space-y-1">
        {visibleMenuItems.map((item) => {
          const Icon = item.icon
          const count = getBadgeCount(item.badgeKey)
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-2 lg:gap-3 px-3 py-2 lg:py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#EFF6FF] text-[#2563EB]'
                    : 'text-[#334155] hover:bg-gray-50'
                }`
              }
            >
              <Icon size={16} />
              <span className="flex-1">{item.label}</span>
              {count > 0 && <Badge count={count} />}
            </NavLink>
          )
        })}
      </nav>

      <div className="px-3 lg:px-4 py-3 lg:py-4 border-t border-gray-100">
        <p className="text-xs text-[#94A3B8]">扫码点餐管理系统 v1.0</p>
      </div>
    </aside>
  )
}
