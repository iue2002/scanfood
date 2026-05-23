import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, KeyRound } from 'lucide-react'
import request from '@/api/request'
import { useModal } from '@/components/ModalProvider'
import { useAuthStore } from '@/stores/auth'

/**
 * 强制改密页：临时密码登录后必须修改一次
 * Validates: Requirements 6.3, 6.4
 */
export default function ForcePasswordChange() {
  const navigate = useNavigate()
  const { showToast } = useModal()
  const logout = useAuthStore((s) => s.logout)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!newPassword || newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      showToast('新密码至少 8 位且需包含字母与数字', 'warning')
      return
    }
    if (newPassword !== confirmPwd) {
      showToast('两次输入的新密码不一致', 'warning')
      return
    }
    setSubmitting(true)
    try {
      await request.post('/merchant-ops/employees/me/change-password', {
        oldPassword,
        newPassword,
      })
      showToast('密码已修改，请重新登录', 'success')
      // 因为 token_version 自增，当前 token 已失效，强制登出走登录页
      logout()
      setTimeout(() => navigate('/login', { replace: true }), 600)
    } catch (err: any) {
      showToast(err?.data?.msg || err?.message || '修改失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#EFF6FF] to-[#F8FAFC] p-4">
      <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto rounded-full bg-[#FEF3C7] flex items-center justify-center mb-3">
            <KeyRound className="w-7 h-7 text-[#92400E]" />
          </div>
          <h1 className="text-xl font-semibold text-[#0F172A] mb-1">设置新密码</h1>
          <p className="text-sm text-[#64748B]">您的密码已被店主重置，首次登录请先设置新密码</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[#64748B] mb-1.5">当前临时密码</label>
            <div className="relative">
              <input
                type={showOld ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="w-full px-3 py-2.5 pr-10 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                placeholder="店主告知的临时密码"
              />
              <button
                type="button"
                onClick={() => setShowOld(!showOld)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#0F172A] cursor-pointer"
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
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#0F172A] cursor-pointer"
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
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            />
          </div>

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-60 cursor-pointer transition-colors"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            修改密码并重新登录
          </button>
        </div>
      </div>
    </div>
  )
}
