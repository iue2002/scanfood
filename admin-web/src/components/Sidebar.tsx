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

const menuItems = [
  { path: '/', label: '桌台看板', icon: LayoutGrid },
  { path: '/dashboard', label: '数据总览', icon: LayoutDashboard },
  { path: '/tables', label: '桌台管理', icon: Armchair },
  { path: '/orders', label: '订单管理', icon: ClipboardList },
  { path: '/dishes', label: '菜品管理', icon: UtensilsCrossed },
  { path: '/refunds', label: '退款售后', icon: RotateCcw },
  { path: '/statistics', label: '数据统计', icon: BarChart3 },
  { path: '/store-settings', label: '店铺设置', icon: Settings },
]

interface SidebarProps {
  open?: boolean
  onClose?: () => void
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <aside
      className={`fixed left-0 top-0 h-full w-56 md:w-64 bg-white border-r border-gray-200 z-50 flex flex-col transition-transform md:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="h-14 md:h-16 flex items-center justify-between px-4 md:px-6 border-b border-gray-100">
        <div className="flex items-center">
          <div className="w-7 h-7 md:w-8 md:h-8 bg-[#2563EB] rounded-lg flex items-center justify-center mr-2 md:mr-3">
            <UtensilsCrossed size={16} md:size={18} className="text-white" />
          </div>
          <span className="text-base md:text-lg font-semibold text-[#0F172A]">扫码点餐</span>
        </div>
        <button onClick={onClose} className="md:hidden p-1 text-[#94A3B8] hover:text-[#0F172A] cursor-pointer">
          <X size={18} md:size={20} />
        </button>
      </div>

      <nav className="flex-1 py-3 md:py-4 px-2 md:px-3 space-y-0.5 md:space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-2 md:gap-3 px-3 py-2 md:py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#EFF6FF] text-[#2563EB]'
                    : 'text-[#334155] hover:bg-gray-50'
                }`
              }
            >
              <Icon size={16} md:size={18} />
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      <div className="px-3 md:px-4 py-3 md:py-4 border-t border-gray-100">
        <p className="text-xs text-[#94A3B8]">扫码点餐管理系统 v1.0</p>
      </div>
    </aside>
  )
}
