import { useMemo, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import {
  User, LogOut, Menu, X, MoreHorizontal,
  LayoutDashboard, Armchair, UtensilsCrossed, RotateCcw, BarChart3, Settings,
} from 'lucide-react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'

interface HeaderProps {
  onMenuClick?: () => void
}

const moreItems = [
  { path: '/dashboard', label: '数据总览', icon: LayoutDashboard },
  { path: '/tables', label: '桌台管理', icon: Armchair },
  { path: '/dishes', label: '菜品管理', icon: UtensilsCrossed },
  { path: '/refunds', label: '退款售后', icon: RotateCcw },
  { path: '/statistics', label: '数据统计', icon: BarChart3 },
  { path: '/store-settings', label: '店铺设置', icon: Settings },
]

export default function Header({ onMenuClick }: HeaderProps) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

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
      <header className="sticky top-0 h-14 lg:h-16 bg-white border-b border-gray-200 z-30 shrink-0 flex items-center justify-between px-3 sm:px-4 lg:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onMenuClick}
            className="hidden"
            aria-label="菜单"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-base sm:text-lg font-semibold text-[#0F172A] truncate">后台管理系统</h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 md:gap-4 shrink-0">
          {/* 桌面端：用户信息 + 退出 */}
          <div className="hidden sm:flex items-center gap-3 md:gap-4">
            <div className="flex items-center gap-2 text-sm text-[#334155]">
              <div className="w-8 h-8 bg-[#EFF6FF] rounded-full flex items-center justify-center">
                <User size={16} className="text-[#2563EB]" />
              </div>
              <span className="hidden md:inline">{user?.nickname || user?.username || '管理员'}</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-sm text-[#EF4444] hover:text-red-700 transition-colors cursor-pointer"
            >
              <LogOut size={16} />
              <span className="hidden md:inline">退出</span>
            </button>
          </div>

          {/* 移动端 / 平板：更多按钮（桌面端有侧边栏，不显示） */}
          <button
            onClick={() => setMoreOpen(true)}
            className={`lg:hidden flex items-center justify-center w-9 h-9 rounded-lg transition-colors cursor-pointer ${
              isMoreActive
                ? 'text-[#2563EB] bg-[#EFF6FF]'
                : 'text-[#64748B] hover:bg-[#F1F5F9]'
            }`}
            aria-label="更多功能"
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
      </header>

      {/* 更多功能抽屉（仅 lg 以下） */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-[#0F172A]">更多功能</h3>
              <button
                onClick={() => setMoreOpen(false)}
                className="p-1 text-[#94A3B8] hover:text-[#0F172A] cursor-pointer"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>

            {/* 用户信息 + 退出（移动端独占一行） */}
            <div className="flex items-center justify-between bg-[#F8FAFC] rounded-xl px-3 py-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-[#334155] min-w-0">
                <div className="w-8 h-8 bg-[#EFF6FF] rounded-full flex items-center justify-center shrink-0">
                  <User size={16} className="text-[#2563EB]" />
                </div>
                <span className="truncate">{user?.nickname || user?.username || '管理员'}</span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 text-sm text-[#EF4444] hover:text-red-700 transition-colors cursor-pointer shrink-0"
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
