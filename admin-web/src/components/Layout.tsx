import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen bg-[#F8FAFC]">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className={`flex-1 flex flex-col transition-all min-w-0 ${sidebarOpen ? 'ml-64' : 'ml-0 md:ml-56 lg:ml-64'}`}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8 min-w-0">
          <Outlet />
        </main>
      </div>
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  )
}
