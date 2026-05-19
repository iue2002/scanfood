import { useAuthStore } from '@/stores/auth'
import { User, LogOut, Menu } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface HeaderProps {
  onMenuClick?: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="sticky top-0 h-14 lg:h-16 bg-white border-b border-gray-200 z-30 shrink-0 flex items-center justify-between px-3 sm:px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="hidden"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-base sm:text-lg font-semibold text-[#0F172A]">后台管理系统</h1>
      </div>
      <div className="hidden sm:flex items-center gap-3 md:gap-4">
        <div className="flex items-center gap-2 text-sm text-[#334155]">
          <div className="w-8 h-8 bg-[#EFF6FF] rounded-full flex items-center justify-center">
            <User size={16} className="text-[#2563EB]" />
          </div>
          <span className="hidden sm:inline">{user?.nickname || user?.username || '管理员'}</span>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 text-sm text-[#EF4444] hover:text-red-700 transition-colors cursor-pointer"
        >
          <LogOut size={16} />
          <span className="hidden sm:inline">退出</span>
        </button>
      </div>
    </header>
  )
}
