import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import BottomNav from './BottomNav'

/**
 * 主布局
 *
 * 关键约束：BottomNav 在 < lg 时 fixed 在视口底部，
 * main 必须给底部留足够空间避免被遮挡：
 *   - BottomNav 自身高度 ≈ 60px（icon 20 + gap 2 + text 12 + py-2*2 = 60px）
 *   - iPhone 全面屏 safe-area-inset-bottom ≈ 34px
 *   - 总计 < lg 预留 max(6rem, 5rem + safe-area) = 通常 6rem 起，全面屏自动加大
 *   - lg 及以上桌面端用 sidebar 不需要底栏 → pb-6 即可
 *
 * 用 Tailwind arbitrary value 实现：
 *   pb-[max(6rem,calc(5rem+env(safe-area-inset-bottom)))] lg:pb-6
 */
export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen bg-[#F8FAFC]">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className={`flex-1 flex flex-col transition-all min-w-0 ${sidebarOpen ? 'ml-64' : 'ml-0 lg:ml-64'}`}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-auto p-3 sm:p-4 lg:p-6 xl:p-8 min-w-0 pb-[max(6rem,calc(5rem+env(safe-area-inset-bottom)))] lg:pb-6">
          <Outlet />
        </main>
      </div>
      <BottomNav />
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  )
}
