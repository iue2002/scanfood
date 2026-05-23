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
  X,
} from 'lucide-react'
import { useUnread } from './UnreadProvider'
import Badge from './Badge'

const menuItems = [
  { path: '/', label: '桌台看板', icon: LayoutGrid, badgeKey: null as null | 'orders' | 'refunds' },
  { path: '/dashboard', label: '数据总览', icon: LayoutDashboard, badgeKey: null },
  { path: '/tables', label: '桌台管理', icon: Armchair, badgeKey: null },
  { path: '/orders', label: '订单管理', icon: ClipboardList, badgeKey: 'orders' as const },
  { path: '/dishes', label: '菜品管理', icon: UtensilsCrossed, badgeKey: null },
  { path: '/refunds', label: '退款售后', icon: RotateCcw, badgeKey: 'refunds' as const },
  { path: '/statistics', label: '数据统计', icon: BarChart3, badgeKey: null },
  { path: '/store-settings', label: '店铺设置', icon: Settings, badgeKey: null },
]

interface SidebarProps {
  open?: boolean
  onClose?: () => void
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const { ordersUnread, refundsUnread } = useUnread()
  const getBadgeCount = (key: null | 'orders' | 'refunds') => {
    if (key === 'orders') return ordersUnread
    if (key === 'refunds') return refundsUnread
    return 0
  }

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
        {menuItems.map((item) => {
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
