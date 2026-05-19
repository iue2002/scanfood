import { useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { useNavigate } from 'react-router-dom'
import {
  LayoutGrid,
  ClipboardList,
  MoreHorizontal,
  LayoutDashboard,
  Armchair,
  UtensilsCrossed,
  RotateCcw,
  BarChart3,
  Settings,
  X,
  User,
  LogOut,
} from 'lucide-react'

const primaryTabs = [
  { path: '/', label: '桌台看板', icon: LayoutGrid },
  { path: '/orders', label: '订单', icon: ClipboardList },
]

const moreItems = [
  { path: '/dashboard', label: '数据总览', icon: LayoutDashboard },
  { path: '/tables', label: '桌台管理', icon: Armchair },
  { path: '/dishes', label: '菜品管理', icon: UtensilsCrossed },
  { path: '/refunds', label: '退款售后', icon: RotateCcw },
  { path: '/statistics', label: '数据统计', icon: BarChart3 },
  { path: '/store-settings', label: '店铺设置', icon: Settings },
]

export default function BottomNav() {
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const isMoreActive = useMemo(
    () => moreItems.some((item) => location.pathname.startsWith(item.path)),
    [location.pathname]
  )

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 lg:hidden">
        <div className="flex items-center justify-around px-4 py-2">
          {primaryTabs.map((tab) => {
            const Icon = tab.icon
            return (
              <NavLink
                key={tab.path}
                to={tab.path}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 text-xs font-medium px-3 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'text-[#2563EB] bg-[#EFF6FF]'
                      : 'text-[#64748B]'
                  }`
                }
              >
                <Icon size={18} />
                {tab.label}
              </NavLink>
            )
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className={`flex flex-col items-center gap-0.5 text-xs font-medium px-3 py-2 rounded-lg transition-colors ${
              isMoreActive ? 'text-[#2563EB] bg-[#EFF6FF]' : 'text-[#64748B]'
            }`}
          >
            <MoreHorizontal size={18} />
            更多
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-[#0F172A]">更多功能</h3>
              <button
                onClick={() => setMoreOpen(false)}
                className="p-1 text-[#94A3B8] hover:text-[#0F172A] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex items-center justify-between bg-[#F8FAFC] rounded-xl px-3 py-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-[#334155]">
                <div className="w-8 h-8 bg-[#EFF6FF] rounded-full flex items-center justify-center">
                  <User size={16} className="text-[#2563EB]" />
                </div>
                <span>{user?.nickname || user?.username || '管理员'}</span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 text-sm text-[#EF4444] hover:text-red-700 transition-colors cursor-pointer"
              >
                <LogOut size={16} />
                退出
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {moreItems.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      `flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-xs font-medium transition-colors ${
                        isActive
                          ? 'text-[#2563EB] bg-[#EFF6FF]'
                          : 'text-[#334155] bg-[#F8FAFC]'
                      }`
                    }
                  >
                    <Icon size={18} />
                    {item.label}
                  </NavLink>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
