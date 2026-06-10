import { useCallback, useEffect, useRef, useState } from 'react'
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

  // 重定向原因横幅（来自 axios 拦截器写入的 sessionStorage）
  const [redirectReason, setRedirectReason] = useState<{ code: string; reason: string } | null>(null)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('login_redirect_reason')
      if (raw) {
        const parsed = JSON.parse(raw) as { code: string; reason: string; at: number }
        // 只显示 5 分钟内的原因（避免老 banner 一直挂着）
        if (parsed.at && Date.now() - parsed.at < 5 * 60 * 1000) {
          setRedirectReason({ code: parsed.code, reason: parsed.reason })
        }
        sessionStorage.removeItem('login_redirect_reason')
      }
    } catch { /* ignore */ }
  }, [])

  // 验证码状态：captchaRequired 由后端响应决定，captcha 是当前图形 token+svg
  const [captchaRequired, setCaptchaRequired] = useState(false)
  const [captcha, setCaptcha] = useState<CaptchaResp | null>(null)
  const [captchaInput, setCaptchaInput] = useState('')
  const [captchaLoading, setCaptchaLoading] = useState(false)

  // 用 ref 避免并发请求互相覆盖（refresh in-flight 时第二次调用直接跳过）
  const captchaInflight = useRef(false)

  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const { showToast } = useModal()

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  const refreshCaptcha = useCallback(async () => {
    if (captchaInflight.current) return
    captchaInflight.current = true
    setCaptchaLoading(true)
    try {
      const res: any = await request.get('/auth/captcha')
      // 防御：res 必须是 { token, svg } 结构
      if (res && typeof res.token === 'string' && typeof res.svg === 'string') {
        setCaptcha(res)
        setCaptchaInput('')
      } else {
        console.error('验证码格式异常', res)
      }
    } catch (e) {
      console.error('获取验证码失败', e)
    } finally {
      captchaInflight.current = false
      setCaptchaLoading(false)
    }
  }, [])

  // 当 captchaRequired 从 false 变 true 时拉一张
  useEffect(() => {
    if (captchaRequired && !captcha && !captchaInflight.current) {
      refreshCaptcha()
    }
  }, [captchaRequired, captcha, refreshCaptcha])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    if (!username.trim() || !password) {
      showToast('请输入账号和密码', 'warning')
      return
    }
    if (captchaRequired) {
      if (!captcha) {
        showToast('验证码加载中，请稍候', 'warning')
        return
      }
      if (!captchaInput.trim()) {
        showToast('请输入验证码', 'warning')
        return
      }
    }

    setLoading(true)

    try {
      const payload: any = {
        username: username.trim(),
        password,
      }
      if (captchaRequired && captcha) {
        payload.captchaToken = captcha.token
        payload.captchaInput = captchaInput.trim()
      }
      const res: any = await request.post('/auth/login', payload)
      if (res?.token) {
        const ll = res.last_login
        const loginInfo = ll ? { at: ll.at, ip: ll.ip } : undefined
        setAuth(res.token, res.user, loginInfo)
        // merchant-ops M1：临时密码登录后强制改密
        if (res?.requirePasswordChange) {
          showToast('您的密码已被重置，请先设置新密码', 'info')
          navigate('/force-password-change', { replace: true })
        } else if (loginInfo) {
          setLastLoginInfo(loginInfo)
          setTimeout(() => navigate('/admin'), 2500)
        } else {
          navigate('/admin')
        }
      } else {
        // 服务端返回 200 但没 token：异常情况
        showToast('登录响应异常', 'error')
      }
    } catch (err: any) {
      const msg = err?.message || '登录失败'
      showToast(typeof msg === 'string' ? msg : '登录失败', 'error')

      // 清空密码：避免浏览器密码管理器把错误密码当成新密码弹出"更新"提示
      setPassword('')

      // 后端要求验证码 → 显示验证码 + 刷新一张
      if (err?.captchaRequired) {
        setCaptcha(null)
        setCaptchaInput('')
        setCaptchaRequired(true)
        refreshCaptcha()
      }
    } finally {
      setLoading(false)
    }
  }

  // 已登录态：展示上次登录信息后跳转
  if (lastLoginInfo) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#EFF6FF] to-[#F1F5F9]">
        <div className="flex-1 flex items-center justify-center p-4">
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
        <div className="py-4 text-center">
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#94A3B8] hover:text-[#2563EB] transition-colors"
          >
            新ICP备2026004458号-1
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#EFF6FF] to-[#F1F5F9]">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 sm:p-8">
          <div className="text-center mb-6 sm:mb-8">
            <div className="w-14 h-14 sm:w-16 sm:h-16 bg-[#2563EB] rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4 shadow-lg">
              <UtensilsCrossed size={28} className="text-white sm:hidden" />
              <UtensilsCrossed size={32} className="text-white hidden sm:block" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#0F172A]">艾力的项目</h1>
            <p className="text-xs sm:text-sm text-[#94A3B8] mt-2">商家后台登录</p>
          </div>

          {/* 重定向原因横幅：仅当用户因会话失效被拦下时显示 */}
          {redirectReason && (
            <div
              className={`mb-4 p-3 rounded-lg flex items-start gap-2.5 border ${
                redirectReason.code === 'ACCOUNT_DISABLED'
                  ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
                  : 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
              }`}
            >
              <ShieldAlert size={18} className="flex-shrink-0 mt-0.5" />
              <div className="text-sm leading-snug">
                <p className="font-medium">
                  {redirectReason.code === 'TOKEN_EXPIRED' && '登录已过期'}
                  {redirectReason.code === 'TOKEN_INVALID' && '登录信息已失效'}
                  {redirectReason.code === 'SESSION_REVOKED' && '会话已被注销'}
                  {redirectReason.code === 'ACCOUNT_DISABLED' && '账号已被禁用'}
                  {!['TOKEN_EXPIRED', 'TOKEN_INVALID', 'SESSION_REVOKED', 'ACCOUNT_DISABLED'].includes(redirectReason.code) && '需要重新登录'}
                </p>
                <p className="text-xs mt-0.5 opacity-90">{redirectReason.reason}</p>
              </div>
            </div>
          )}

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
                    className="flex-1 min-w-0 px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent transition-all uppercase tracking-wider"
                  />
                  <button
                    type="button"
                    onClick={refreshCaptcha}
                    className="shrink-0 h-[42px] w-[140px] flex items-center justify-center bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-[#2563EB] transition-colors cursor-pointer"
                    title="点击换一张"
                    aria-label="刷新验证码"
                  >
                    {captchaLoading || !captcha || typeof captcha.svg !== 'string' ? (
                      <Loader size={18} className="animate-spin text-[#94A3B8]" />
                    ) : (
                      <span
                        className="block w-full h-full flex items-center justify-center"
                        // 验证码 SVG 来自后端可信 API；上面的 typeof 检查防止 undefined 注入
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
      <div className="py-4 text-center">
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[#94A3B8] hover:text-[#2563EB] transition-colors"
        >
          新ICP备2026004458号-1
        </a>
      </div>
    </div>
  )
}
