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
  Printer,
  Layers,
  X,
} from 'lucide-react'
import { useUnread } from './UnreadProvider'
import Badge from './Badge'
import { useAuthStore } from '@/stores/auth'
import type { Role } from '@/rbac/types'

type MenuGroup = 'main' | 'business' | 'data' | 'mop' | 'personal'

interface MenuItem {
  path: string
  label: string
  icon: typeof LayoutGrid
  badgeKey: null | 'orders' | 'refunds'
  visibleFor: null | ReadonlyArray<Role>
  group: MenuGroup
}

const menuItems: MenuItem[] = [
  // 主工作区（全员可见）
  { path: '/', label: '桌台看板', icon: LayoutGrid, badgeKey: null, visibleFor: null, group: 'main' },
  { path: '/orders', label: '订单管理', icon: ClipboardList, badgeKey: 'orders', visibleFor: null, group: 'main' },
  // 业务管理（经理及以上）
  { path: '/tables', label: '桌台管理', icon: Armchair, badgeKey: null, visibleFor: ['owner', 'manager', 'admin'], group: 'business' },
  { path: '/dishes', label: '菜品管理', icon: UtensilsCrossed, badgeKey: null, visibleFor: ['owner', 'manager', 'admin'], group: 'business' },
  { path: '/refunds', label: '退款售后', icon: RotateCcw, badgeKey: 'refunds', visibleFor: ['owner', 'manager', 'admin'], group: 'business' },
  { path: '/store-settings', label: '店铺设置', icon: Settings, badgeKey: null, visibleFor: ['owner', 'manager', 'admin'], group: 'business' },
  // 数据中心（仅店主）
  { path: '/dashboard', label: '数据总览', icon: LayoutDashboard, badgeKey: null, visibleFor: ['owner', 'admin'], group: 'data' },
  { path: '/statistics', label: '数据统计', icon: BarChart3, badgeKey: null, visibleFor: ['owner', 'admin'], group: 'data' },
  { path: '/data-export', label: '数据导出', icon: Download, badgeKey: null, visibleFor: ['owner', 'admin'], group: 'data' },
  // 运营中心（mop）
  { path: '/employees', label: '员工管理', icon: Users, badgeKey: null, visibleFor: ['owner', 'admin'], group: 'mop' },
  { path: '/printers', label: '打印设置', icon: Printer, badgeKey: null, visibleFor: ['owner', 'manager', 'admin'], group: 'mop' },
  { path: '/print-plans', label: '打印方案', icon: Layers, badgeKey: null, visibleFor: ['owner', 'manager', 'admin'], group: 'mop' },
  { path: '/audit-logs', label: '审计日志', icon: ScrollText, badgeKey: null, visibleFor: ['owner', 'manager', 'admin'], group: 'mop' },
  // 个人偏好（全员）
  { path: '/notif-settings', label: '通知管理', icon: Bell, badgeKey: null, visibleFor: null, group: 'personal' },
]

const GROUP_LABEL: Record<MenuGroup, string | null> = {
  main: null,
  business: '业务管理',
  data: '数据中心',
  mop: '运营中心',
  personal: '个人偏好',
}

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

  // 按 group 分组渲染
  const groupedItems = visibleMenuItems.reduce<Record<MenuGroup, MenuItem[]>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = []
    acc[item.group].push(item)
    return acc
  }, {} as Record<MenuGroup, MenuItem[]>)

  const groupOrder: MenuGroup[] = ['main', 'business', 'data', 'mop', 'personal']

  return (
    <aside
      className={`fixed left-0 top-0 pt-[env(safe-area-inset-top)] h-full w-56 lg:w-64 bg-white border-r border-gray-200 z-50 flex flex-col transition-transform lg:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="h-14 lg:h-16 flex items-center justify-between px-4 lg:px-6 border-b border-gray-100">
        <div className="flex items-center">
          <div className="w-7 h-7 lg:w-8 lg:h-8 bg-[#2563EB] rounded-lg flex items-center justify-center mr-2 lg:mr-3">
            <UtensilsCrossed className="text-white w-4 h-4 lg:w-[18px] lg:h-[18px]" />
          </div>
          <span className="text-base lg:text-lg font-semibold text-[#0F172A]">扫码点餐</span>
        </div>
        <button onClick={onClose} className="lg:hidden p-1 text-[#94A3B8] hover:text-[#0F172A] cursor-pointer">
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 py-3 lg:py-4 px-2 lg:px-3 space-y-0.5 lg:space-y-1 overflow-y-auto">
        {groupOrder.map((group) => {
          const items = groupedItems[group]
          if (!items || items.length === 0) return null
          const label = GROUP_LABEL[group]
          return (
            <div key={group} className={group === 'main' ? '' : 'mt-2 lg:mt-3 pt-2 lg:pt-3 border-t border-gray-100'}>
              {label && (
                <div className="px-3 pb-1 lg:pb-1.5 text-[10px] lg:text-xs font-medium uppercase tracking-wider text-[#94A3B8]">
                  {label}
                </div>
              )}
              {items.map((item) => {
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
            </div>
          )
        })}
      </nav>

      <div className="px-3 lg:px-4 py-3 lg:py-4 border-t border-gray-100">
        <p className="text-xs text-[#94A3B8]">艾力的项目 v1.0</p>
      </div>
    </aside>
  )
}
