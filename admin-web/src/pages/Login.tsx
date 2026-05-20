import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import request from '@/api/request'
import { UtensilsCrossed, Loader, Eye, EyeOff, Clock, ShieldAlert } from 'lucide-react'
import { useModal } from '@/components/ModalProvider'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lastLoginInfo, setLastLoginInfo] = useState<{ at: string; ip: string } | null>(null)
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const { showToast } = useModal()

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    setLoading(true)
    setLastLoginInfo(null)

    try {
      const res: any = await request.post('/auth/login', { username, password })
      if (res?.token) {
        const ll = res.last_login
        const loginInfo = ll ? { at: ll.at, ip: ll.ip } : null
        setAuth(res.token, res.user, loginInfo)
        if (loginInfo) {
          setLastLoginInfo(loginInfo)
          // 短暂展示上次登录信息后跳转
          setTimeout(() => navigate('/'), 2500)
        } else {
          navigate('/')
        }
      }
    } catch (err: any) {
      const msg = err?.message || '登录失败'
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  // 登录成功，展示上次登录信息
  if (lastLoginInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#EFF6FF] to-[#F1F5F9]">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
          <ShieldAlert size={48} className="text-[#10B981] mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[#0F172A] mb-2">登录成功</h2>
          <p className="text-sm text-[#64748B] mb-4">
            上次登录时间：{formatTime(lastLoginInfo.at)}
          </p>
          <p className="text-sm text-[#64748B]">
            上次登录 IP：{lastLoginInfo.ip}
          </p>
          <div className="flex items-center justify-center gap-2 mt-4 text-xs text-[#94A3B8]">
            <Clock size={14} />
            即将跳转...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#EFF6FF] to-[#F1F5F9]">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#2563EB] rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <UtensilsCrossed size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A]">扫码点餐管理系统</h1>
          <p className="text-sm text-[#94A3B8] mt-2">商家后台登录</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-[#334155] mb-1.5">账号</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入账号"
              autoComplete="username"
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#334155] mb-1.5">密码</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
                className="w-full px-4 py-2.5 pr-10 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#334155] transition-colors cursor-pointer"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
          >
            {loading ? <Loader size={16} className="animate-spin" /> : null}
            登录
          </button>
        </form>

        <p className="text-xs text-[#94A3B8] text-center mt-4">
          连续输错 5 次密码，账户将临时锁定 30 分钟
        </p>
      </div>
    </div>
  )
}
