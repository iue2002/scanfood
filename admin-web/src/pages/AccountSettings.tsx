import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, KeyRound, UserCog, ChevronLeft } from 'lucide-react'
import request from '@/api/request'
import { useModal } from '@/components/ModalProvider'
import { useAuthStore } from '@/stores/auth'

type TabKey = 'username' | 'password'

/**
 * 账户设置页：员工自助修改自己的登录用户名 / 密码
 *
 * 安全约束：
 * - 改用户名：必须验证当前密码
 * - 改密码：必须验证旧密码，且新旧不同；改完后强制重新登录（token_version 变更）
 *
 * 路径：/account-settings（任何登录员工可访问）
 */
export default function AccountSettings() {
  const navigate = useNavigate()
  const { showToast, showConfirm } = useModal()
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  const setAuth = useAuthStore((s) => s.setAuth)
  const logout = useAuthStore((s) => s.logout)

  const [tab, setTab] = useState<TabKey>('username')

  // 改用户名
  const [newUsername, setNewUsername] = useState('')
  const [usernamePwd, setUsernamePwd] = useState('')
  const [showUsernamePwd, setShowUsernamePwd] = useState(false)
  const [savingUsername, setSavingUsername] = useState(false)

  // 改密码
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  const submitUsername = async () => {
    const trimmed = newUsername.trim()
    if (!trimmed || trimmed.length < 3 || trimmed.length > 30) {
      showToast('用户名长度需在 3~30 之间', 'warning')
      return
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      showToast('用户名仅支持字母、数字与下划线', 'warning')
      return
    }
    if (trimmed === user?.username) {
      showToast('新用户名与当前用户名相同', 'warning')
      return
    }
    if (!usernamePwd) {
      showToast('请输入当前登录密码以确认操作', 'warning')
      return
    }

    showConfirm(
      '确认修改用户名',
      `当前账号 “${user?.username || ''}” 将更新为 “${trimmed}”。下次登录请使用新用户名。`,
      async () => {
        setSavingUsername(true)
        try {
          const res: any = await request.post('/merchant-ops/employees/me/change-username', {
            newUsername: trimmed,
            password: usernamePwd,
          })
          const updated = res?.data ?? res
          // 同步前端 store + localStorage（JWT 不含 username，无需重新登录）
          if (token && user) {
            setAuth(token, { ...user, username: updated?.username || trimmed })
          }
          setUsernamePwd('')
          setNewUsername('')
          showToast('用户名修改成功', 'success')
        } catch (err: any) {
          showToast(err?.msg || err?.message || '修改失败', 'error')
        } finally {
          setSavingUsername(false)
        }
      },
    )
  }

  const submitPassword = async () => {
    if (!oldPassword) {
      showToast('请输入旧密码', 'warning')
      return
    }
    if (!newPassword || newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      showToast('新密码至少 8 位且需包含字母与数字', 'warning')
      return
    }
    if (newPassword !== confirmPwd) {
      showToast('两次输入的新密码不一致', 'warning')
      return
    }
    if (newPassword === oldPassword) {
      showToast('新密码与旧密码不能相同', 'warning')
      return
    }
    setSavingPassword(true)
    try {
      await request.post('/merchant-ops/employees/me/change-password', {
        oldPassword,
        newPassword,
      })
      showToast('密码已修改，请重新登录', 'success')
      // bumpTokenVersion 后当前 token 失效，强制走登录页
      setTimeout(() => {
        logout()
        navigate('/login', { replace: true })
      }, 600)
    } catch (err: any) {
      showToast(err?.msg || err?.message || '修改失败', 'error')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-[#64748B] hover:bg-[#F1F5F9] cursor-pointer"
          aria-label="返回"
        >
          <ChevronLeft size={20} />
        </button>
        <h2 className="text-lg sm:text-xl font-semibold text-[#0F172A]">账户设置</h2>
      </div>

      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm">
        {/* 当前账号信息 */}
        <div className="px-5 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] rounded-t-xl flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-[#475569]">
            当前登录用户：
            <span className="font-medium text-[#0F172A] ml-1">{user?.username || '-'}</span>
            <span className="text-[#94A3B8] ml-2">（{user?.role || '-'}）</span>
          </div>
        </div>

        {/* tab 切换 */}
        <div className="flex border-b border-[#E2E8F0]">
          <button
            type="button"
            onClick={() => setTab('username')}
            className={`flex-1 sm:flex-none px-5 py-3 text-sm font-medium border-b-2 cursor-pointer transition-colors ${
              tab === 'username'
                ? 'border-[#2563EB] text-[#2563EB]'
                : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <span className="inline-flex items-center gap-1.5"><UserCog size={16} />修改用户名</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('password')}
            className={`flex-1 sm:flex-none px-5 py-3 text-sm font-medium border-b-2 cursor-pointer transition-colors ${
              tab === 'password'
                ? 'border-[#2563EB] text-[#2563EB]'
                : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <span className="inline-flex items-center gap-1.5"><KeyRound size={16} />修改密码</span>
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-5">
          {tab === 'username' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-xs text-[#64748B] mb-1.5">新用户名</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  placeholder="3~30 位字母、数字或下划线"
                  maxLength={30}
                  autoComplete="off"
                />
              </div>

              <div>
                <label className="block text-xs text-[#64748B] mb-1.5">当前登录密码</label>
                <div className="relative">
                  <input
                    type={showUsernamePwd ? 'text' : 'password'}
                    value={usernamePwd}
                    onChange={(e) => setUsernamePwd(e.target.value)}
                    className="w-full px-3 py-2.5 pr-10 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    placeholder="输入当前登录密码以确认"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowUsernamePwd(!showUsernamePwd)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#0F172A] cursor-pointer"
                    aria-label="切换密码显示"
                  >
                    {showUsernamePwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="rounded-lg bg-[#FEF3C7] border border-[#FDE68A] px-3 py-2 text-xs text-[#92400E]">
                修改成功后，下次登录请使用新用户名。当前会话不会立即失效。
              </div>

              <button
                onClick={submitUsername}
                disabled={savingUsername}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-60 cursor-pointer transition-colors"
              >
                {savingUsername && <Loader2 size={14} className="animate-spin" />}
                保存新用户名
              </button>
            </div>
          )}

          {tab === 'password' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-xs text-[#64748B] mb-1.5">旧密码</label>
                <div className="relative">
                  <input
                    type={showOld ? 'text' : 'password'}
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    className="w-full px-3 py-2.5 pr-10 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    placeholder="当前登录密码"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOld(!showOld)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#0F172A] cursor-pointer"
                    aria-label="切换密码显示"
                  >
                    {showOld ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-[#64748B] mb-1.5">新密码</label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2.5 pr-10 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    placeholder="至少 8 位，包含字母与数字"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#0F172A] cursor-pointer"
                    aria-label="切换密码显示"
                  >
                    {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-[#64748B] mb-1.5">再次输入新密码</label>
                <input
                  type={showNew ? 'text' : 'password'}
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  className="w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  placeholder="确认新密码"
                  autoComplete="new-password"
                  onKeyDown={(e) => { if (e.key === 'Enter') submitPassword() }}
                />
              </div>

              <div className="rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-3 py-2 text-xs text-[#991B1B]">
                修改密码后，所有设备上的当前会话都会立即失效，需要使用新密码重新登录。
              </div>

              <button
                onClick={submitPassword}
                disabled={savingPassword}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-60 cursor-pointer transition-colors"
              >
                {savingPassword && <Loader2 size={14} className="animate-spin" />}
                修改密码并重新登录
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
