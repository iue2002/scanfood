import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import request from '@/api/request'
import { UtensilsCrossed, Loader, Eye, EyeOff, Clock, ShieldAlert, RefreshCw } from 'lucide-react'
import { useModal } from '@/components/ModalProvider'

interface CaptchaResp { token: string; svg: string }

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lastLoginInfo, setLastLoginInfo] = useState<{ at: string; ip: string } | null>(null)

  // 验证码状态
  const [captchaRequired, setCaptchaRequired] = useState(false)
  const [captcha, setCaptcha] = useState<CaptchaResp | null>(null)
  const [captchaInput, setCaptchaInput] = useState('')
  const [captchaLoading, setCaptchaLoading] = useState(false)

  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const { showToast } = useModal()

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true)
    try {
      const res: any = await request.get('/auth/captcha')
      setCaptcha(res)
      setCaptchaInput('')
    } catch (e) {
      // 拉验证码失败，不打断登录流程
      console.error('获取验证码失败', e)
    } finally {
      setCaptchaLoading(false)
    }
  }, [])

  // 一旦需要验证码，立即拉一张
  useEffect(() => {
    if (captchaRequired && !captcha) {
      refreshCaptcha()
    }
  }, [captchaRequired, captcha, refreshCaptcha])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    if (captchaRequired && !captchaInput) {
      showToast('请输入验证码', 'warning')
      return
    }
    setLoading(true)
    setLastLoginInfo(null)

    try {
      const payload: any = { username, password }
      if (captchaRequired && captcha) {
        payload.captchaToken = captcha.token
        payload.captchaInput = captchaInput
      }
      const res: any = await request.post('/auth/login', payload)
      if (res?.token) {
        const ll = res.last_login
        const loginInfo = ll ? { at: ll.at, ip: ll.ip } : null
        setAuth(res.token, res.user, loginInfo)
        if (loginInfo) {
          setLastLoginInfo(loginInfo)
          setTimeout(() => navigate('/'), 2500)
        } else {
          navigate('/')
        }
      }
    } catch (err: any) {
      const msg = err?.message || '登录失败'
      showToast(msg, 'error')
      // 后端要求验证码 → 显示输入框，刷新一张新验证码
      if (err?.captchaRequired) {
        setCaptchaRequired(true)
        refreshCaptcha()
      }
    } finally {
      setLoading(false)
    }
  }

  if (lastLoginInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#EFF6FF] to-[#F1F5F9] p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 sm:p-8 text-center">
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#EFF6FF] to-[#F1F5F9] p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 sm:p-8">
        <div className="text-center mb-6 sm:mb-8">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-[#2563EB] rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4 shadow-lg">
            <UtensilsCrossed size={28} className="text-white sm:hidden" />
            <UtensilsCrossed size={32} className="text-white hidden sm:block" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#0F172A]">扫码点餐管理系统</h1>
          <p className="text-xs sm:text-sm text-[#94A3B8] mt-2">商家后台登录</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
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

          {/* 验证码：失败一次后出现 */}
          {captchaRequired && (
            <div>
              <label className="block text-sm font-medium text-[#334155] mb-1.5">图形验证码</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={captchaInput}
                  onChange={(e) => setCaptchaInput(e.target.value)}
                  placeholder="请输入图中字符"
                  maxLength={8}
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent transition-all uppercase tracking-wider"
                />
                <button
                  type="button"
                  onClick={refreshCaptcha}
                  className="shrink-0 h-[42px] w-[140px] flex items-center justify-center bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-[#2563EB] transition-colors cursor-pointer relative"
                  title="点击换一张"
                >
                  {captchaLoading || !captcha ? (
                    <Loader size={18} className="animate-spin text-[#94A3B8]" />
                  ) : (
                    <span
                      className="block w-full h-full"
                      // 后端返回的 svg 字符串直接渲染
                      dangerouslySetInnerHTML={{ __html: captcha.svg }}
                    />
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={refreshCaptcha}
                className="mt-1.5 text-xs text-[#94A3B8] hover:text-[#2563EB] inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw size={12} /> 看不清？换一张
              </button>
            </div>
          )}

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
