import { ShieldAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

/**
 * /forbidden 页：路由守卫拒绝访问时跳转到这里
 * Validates: Requirements 1.8
 */
export default function Forbidden() {
  const navigate = useNavigate()
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6">
      <div className="w-16 h-16 rounded-full bg-[#FEF2F2] flex items-center justify-center">
        <ShieldAlert className="w-8 h-8 text-[#EF4444]" />
      </div>
      <div className="text-center max-w-md">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-1">无权访问</h2>
        <p className="text-sm text-[#64748B]">
          您当前的角色没有权限查看该页面。如有疑问请联系店主。
        </p>
      </div>
      <button
        onClick={() => navigate('/')}
        className="px-5 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors"
      >
        返回首页
      </button>
    </div>
  )
}
