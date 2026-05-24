import { useMemo, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import {
  User, LogOut, X, MoreHorizontal,
  LayoutDashboard, Armchair, UtensilsCrossed, RotateCcw, BarChart3, Settings,
  Users, ScrollText, Bell, Download, Printer, Layers,
} from 'lucide-react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import type { Role } from '@/rbac/types'

interface HeaderProps {
  onMenuClick?: () => void
}

interface MoreItem {
  path: string
  label: string
  icon: typeof Users
  visibleFor: null | ReadonlyArray<Role>
  group: '业务管理' | '数据中心' | '运营中心' | '个人偏好'
}

/**
 * 移动端 / 平板"更多功能"抽屉的入口列表
 * 与 Sidebar.tsx 的 menuItems 保持一致（除桌台看板/订单 两项底部 nav 已有），
 * 配合角色过滤
 */
const moreItems: MoreItem[] = [
  // 业务管理
  { path: '/tables', label: '桌台管理', icon: Armchair, visibleFor: ['owner', 'manager', 'admin'], group: '业务管理' },
  { path: '/dishes', label: '菜品管理', icon: UtensilsCrossed, visibleFor: ['owner', 'manager', 'admin'], group: '业务管理' },
  { path: '/refunds', label: '退款售后', icon: RotateCcw, visibleFor: ['owner', 'manager', 'admin'], group: '业务管理' },
  { path: '/store-settings', label: '店铺设置', icon: Settings, visibleFor: ['owner', 'manager', 'admin'], group: '业务管理' },
  // 数据中心
  { path: '/dashboard', label: '数据总览', icon: LayoutDashboard, visibleFor: ['owner', 'admin'], group: '数据中心' },
  { path: '/statistics', label: '数据统计', icon: BarChart3, visibleFor: ['owner', 'admin'], group: '数据中心' },
  { path: '/data-export', label: '数据导出', icon: Download, visibleFor: ['owner', 'admin'], group: '数据中心' },
  // 运营中心
  { path: '/employees', label: '员工管理', icon: Users, visibleFor: ['owner', 'admin'], group: '运营中心' },
  { path: '/printers', label: '打印设置', icon: Printer, visibleFor: ['owner', 'manager', 'admin'], group: '运营中心' },
  { path: '/print-plans', label: '打印方案', icon: Layers, visibleFor: ['owner', 'manager', 'admin'], group: '运营中心' },
  { path: '/audit-logs', label: '审计日志', icon: ScrollText, visibleFor: ['owner', 'manager', 'admin'], group: '运营中心' },
  // 个人偏好
  { path: '/notif-settings', label: '通知偏好', icon: Bell, visibleFor: null, group: '个人偏好' },
]

const groupOrder: MoreItem['group'][] = ['业务管理', '数据中心', '运营中心', '个人偏好']

export default function Header(_: HeaderProps) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  const role = user?.role as Role | undefined

  // 按角色过滤可见项
  const visibleItems = useMemo(() => {
    return moreItems.filter((item) => {
      if (!item.visibleFor) return true
      if (!role) return false
      return item.visibleFor.includes(role)
    })
  }, [role])

  // 按 group 分组
  const groupedItems = useMemo(() => {
    const map: Record<MoreItem['group'], MoreItem[]> = {
      业务管理: [], 数据中心: [], 运营中心: [], 个人偏好: [],
    }
    for (const item of visibleItems) map[item.group].push(item)
    return map
  }, [visibleItems])

  const isMoreActive = useMemo(
    () => visibleItems.some((item) => location.pathname.startsWith(item.path)),
    [location.pathname, visibleItems]
  )

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <header className="sticky top-0 h-14 lg:h-16 bg-white border-b border-gray-200 z-30 shrink-0 flex items-center justify-between px-3 sm:px-4 lg:px-6">
        <div className="flex items-center gap-3 min-w-0">
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
              className="flex items-center gap-1 text-sm text-[#EF4444] hover:text-red-700 transition-colors cursor-pointer min-h-[44px] px-2"
            >
              <LogOut size={16} />
              <span className="hidden md:inline">退出</span>
            </button>
          </div>

          {/* 移动端 / 平板：更多按钮（桌面端有侧边栏，不显示） */}
          <button
            onClick={() => setMoreOpen(true)}
            className={`lg:hidden flex items-center justify-center w-11 h-11 rounded-lg transition-colors cursor-pointer ${
              isMoreActive
                ? 'text-[#2563EB] bg-[#EFF6FF]'
                : 'text-[#64748B] hover:bg-[#F1F5F9]'
            }`}
            aria-label="更多功能"
          >
            <MoreHorizontal size={22} />
          </button>
        </div>
      </header>

      {/* 更多功能抽屉（仅 lg 以下） */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl flex flex-col max-h-[85vh]">
            {/* 抽屉头：标题 + 关闭 */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
              <h3 className="text-base font-semibold text-[#0F172A]">更多功能</h3>
              <button
                onClick={() => setMoreOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
                aria-label="关闭"
              >
                <X size={20} />
              </button>
            </div>

            {/* 抽屉滚动内容区 */}
            <div className="flex-1 overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
              {/* 用户信息 + 退出 */}
              <div className="flex items-center justify-between bg-[#F8FAFC] rounded-xl px-3 py-2.5 mb-4">
                <div className="flex items-center gap-2 text-sm text-[#334155] min-w-0">
                  <div className="w-9 h-9 bg-[#EFF6FF] rounded-full flex items-center justify-center shrink-0">
                    <User size={18} className="text-[#2563EB]" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{user?.nickname || user?.username || '管理员'}</p>
                    {role && <p className="text-xs text-[#94A3B8] truncate">{role}</p>}
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1 text-sm text-[#EF4444] hover:bg-red-50 transition-colors cursor-pointer shrink-0 px-3 py-2 rounded-lg min-h-[40px]"
                >
                  <LogOut size={16} />
                  退出
                </button>
              </div>

              {/* 分组菜单 */}
              {groupOrder.map((group) => {
                const items = groupedItems[group]
                if (items.length === 0) return null
                return (
                  <div key={group} className="mb-4 last:mb-0">
                    <p className="text-xs font-medium text-[#94A3B8] mb-2 px-1">{group}</p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                      {items.map((item) => {
                        const Icon = item.icon
                        return (
                          <NavLink
                            key={item.path}
                            to={item.path}
                            onClick={() => setMoreOpen(false)}
                            className={({ isActive }) =>
                              `flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-xs font-medium transition-colors min-h-[72px] justify-center ${
                                isActive
                                  ? 'text-[#2563EB] bg-[#EFF6FF]'
                                  : 'text-[#334155] bg-[#F8FAFC] hover:bg-[#F1F5F9]'
                              }`
                            }
                          >
                            <Icon size={20} />
                            <span className="text-center leading-tight">{item.label}</span>
                          </NavLink>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
