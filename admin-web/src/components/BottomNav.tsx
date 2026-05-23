import { NavLink } from 'react-router-dom'
import { LayoutGrid, ClipboardList } from 'lucide-react'
import { useUnread } from './UnreadProvider'
import Badge from './Badge'

// 移动端 / 平板的底部 TabBar：仅保留两个最高频入口（桌台看板、订单）
// "更多"按钮已上移到 Header 右上角，避免误触
const primaryTabs = [
  { path: '/', label: '桌台看板', icon: LayoutGrid, badgeKey: null as null | 'orders' },
  { path: '/orders', label: '订单', icon: ClipboardList, badgeKey: 'orders' as const },
]

export default function BottomNav() {
  const { ordersUnread } = useUnread()
  const getBadgeCount = (key: null | 'orders') => (key === 'orders' ? ordersUnread : 0)

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 lg:hidden">
      <div className="flex items-center justify-around px-4 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        {primaryTabs.map((tab) => {
          const Icon = tab.icon
          const count = getBadgeCount(tab.badgeKey)
          return (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.path === '/'}
              className={({ isActive }) =>
                `relative flex flex-col items-center gap-0.5 text-xs font-medium px-6 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'text-[#2563EB] bg-[#EFF6FF]'
                    : 'text-[#64748B]'
                }`
              }
            >
              <span className="relative">
                <Icon size={20} />
                {count > 0 && (
                  <span className="absolute -top-1 -right-2">
                    <Badge count={count} />
                  </span>
                )}
              </span>
              {tab.label}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
