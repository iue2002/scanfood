import { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  BellOff,
  Loader2,
  Play,
  Save,
  Volume2,
  Monitor,
  Smartphone,
  Mail,
  Send,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import request from '@/api/request'
import { useModal } from '@/components/ModalProvider'
import {
  loadNotifPref,
  listSounds,
  saveNotifPref,
  getNotifPref,
} from '@/notif/notif-pref-store'
import type { SoundEntry } from '@/notif/notif-pref-store'
import type { DesktopEvent } from '@/notif/notification-decision'
import { ALL_DESKTOP_EVENTS } from '@/notif/notification-decision'
import { previewSound } from '@/notif/audio-player'
import { detectPushCapability, subscribePush, unsubscribePush } from '@/notif/web-push'

const EVENT_LABEL: Record<DesktopEvent, string> = {
  NEW_ORDER: '新订单',
  ADD_ITEM: '加餐',
  REFUND: '退款',
}

const EVENT_DESC: Record<DesktopEvent, string> = {
  NEW_ORDER: '顾客在桌上提交订单时',
  ADD_ITEM: '已下单订单加菜时',
  REFUND: '收到退款申请或退款审核结果时',
}

export default function NotifSettings() {
  const { showToast } = useModal()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [sounds, setSounds] = useState<SoundEntry[]>([])
  const [pref, setPref] = useState(getNotifPref())
  const [permissionState, setPermissionState] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  )

  // Web Push 状态
  const [pushSupported, setPushSupported] = useState(false)
  const [pushSupportReason, setPushSupportReason] = useState<string | undefined>()
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushPlatform, setPushPlatform] = useState<'edge-desktop' | 'chrome-desktop' | 'firefox-desktop' | 'safari-ios' | 'android' | 'other'>('other')
  const [pushLikelyBlocked, setPushLikelyBlocked] = useState(false)

  // 邮件测试发送
  const [testingEmail, setTestingEmail] = useState(false)

  useEffect(() => {
    Promise.all([
      loadNotifPref(),
      listSounds(),
    ])
      .then(([loadedPref, loadedSounds]) => {
        setPref(loadedPref)
        setSounds(loadedSounds)
      })
      .catch((err: any) => {
        showToast(err?.message || '加载偏好失败，已使用本地缓存', 'warning')
      })
      .finally(() => setLoading(false))

    // 检测 Web Push 能力 + 当前订阅状态
    detectPushCapability().then((cap) => {
      setPushSupported(cap.supported)
      setPushSupportReason(cap.reason)
      setPushSubscribed(cap.subscribed)
      setPushPlatform(cap.platform)
      setPushLikelyBlocked(cap.likelyBlocked)
    })
  }, [showToast])

  const handleEnablePush = async () => {
    setPushBusy(true)
    try {
      // 先确保通知权限
      if (Notification.permission !== 'granted') {
        const result = await Notification.requestPermission()
        setPermissionState(result)
        if (result !== 'granted') {
          showToast('通知权限未授予，无法开启 Web Push', 'warning')
          return
        }
      }
      const r = await subscribePush()
      if (r.ok) {
        setPushSubscribed(true)
        showToast('Web Push 已开启，关浏览器/锁屏也能收到', 'success')
      } else {
        showToast(r.reason || 'Web Push 开启失败', 'error')
      }
    } finally {
      setPushBusy(false)
    }
  }

  const handleDisablePush = async () => {
    setPushBusy(true)
    try {
      const r = await unsubscribePush()
      if (r.ok) {
        setPushSubscribed(false)
        showToast('Web Push 已关闭', 'info')
      } else {
        showToast(r.reason || 'Web Push 关闭失败', 'error')
      }
    } finally {
      setPushBusy(false)
    }
  }

  const fallbackUrl = useMemo(
    () => sounds.find((s) => s.id === 'default')?.url ?? sounds[0]?.url ?? '',
    [sounds],
  )

  const handleToggleSoundEnabled = (val: boolean) => {
    setPref((p) => ({ ...p, sound_enabled: val }))
  }

  const handleSelectSound = (id: string) => {
    setPref((p) => ({ ...p, sound_id: id }))
  }

  const handleToggleEvent = async (event: DesktopEvent, checked: boolean) => {
    if (checked) {
      // R10.3: permission=default 时申请；R10.4: denied 拒绝设置非空
      if (typeof Notification !== 'undefined') {
        if (Notification.permission === 'default') {
          const result = await Notification.requestPermission()
          setPermissionState(result)
          if (result === 'denied') {
            showToast('已被浏览器拒绝，请在站点设置中启用通知', 'warning')
            return
          }
        } else if (Notification.permission === 'denied') {
          showToast('已被浏览器拒绝，请在站点设置中启用通知', 'warning')
          return
        }
      }
    }
    setPref((p) => {
      const next = new Set(p.desktop_events)
      if (checked) next.add(event)
      else next.delete(event)
      return { ...p, desktop_events: ALL_DESKTOP_EVENTS.filter((e) => next.has(e)) }
    })
  }

  const handleToggleEmailEvent = (event: DesktopEvent, checked: boolean) => {
    setPref((p) => {
      const next = new Set(p.email_events)
      if (checked) next.add(event)
      else next.delete(event)
      return { ...p, email_events: ALL_DESKTOP_EVENTS.filter((e) => next.has(e)) }
    })
  }

  const handleEmailChange = (val: string) => {
    setPref((p) => ({ ...p, email: val.length === 0 ? null : val }))
  }

  const handlePreview = async (entry: SoundEntry) => {
    if (previewingId) return
    setPreviewingId(entry.id)
    try {
      const result = await previewSound(entry.url, fallbackUrl || entry.url)
      if (result.fellbackToDefault) {
        showToast('音色加载失败，已降级为默认', 'warning')
      } else if (!result.ok) {
        showToast(result.error || '音色试听失败', 'error')
      }
    } finally {
      setPreviewingId(null)
    }
  }

  const handleSave = async () => {
    // 邮件简单格式校验（仅在填了的情况下）
    if (pref.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pref.email)) {
      showToast('邮箱格式不合法', 'warning')
      return
    }
    setSaving(true)
    try {
      const saved = await saveNotifPref(pref)
      setPref(saved)
      showToast('已保存通知偏好', 'success')
    } catch (err: any) {
      showToast(err?.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleSendTestEmail = async () => {
    if (!pref.email) {
      showToast('请先填写邮箱地址', 'warning')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pref.email)) {
      showToast('邮箱格式不合法', 'warning')
      return
    }
    setTestingEmail(true)
    try {
      const res: any = await request.post('/notif/email/test', { to: pref.email })
      if (res?.success !== false) {
        showToast(res?.message || '测试邮件已发送，请检查收件箱', 'success')
      } else {
        showToast(res?.message || '测试邮件发送失败', 'error')
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '测试邮件发送失败'
      showToast(msg, 'error')
    } finally {
      setTestingEmail(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-[#2563EB]" />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 bg-[#F8FAFC] min-h-screen">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#EFF6FF] flex items-center justify-center">
            <Bell className="w-5 h-5 text-[#2563EB]" />
          </div>
          <div>
            <h1 className="text-lg lg:text-xl font-semibold text-[#0F172A]">通知偏好</h1>
            <p className="text-xs text-[#94A3B8] mt-0.5">声音、桌面通知、Web Push、邮件兜底</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          保存
        </button>
      </div>

      {permissionState === 'denied' && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2]">
          <AlertCircle className="w-4 h-4 mt-0.5 text-[#DC2626] shrink-0" />
          <div className="text-sm text-[#991B1B]">
            浏览器已拒绝桌面通知权限。请在浏览器站点设置中允许通知后，刷新页面再试。
          </div>
        </div>
      )}

      {/* 声音 */}
      <section className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-5 mb-4">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Volume2 className="w-5 h-5 text-[#2563EB]" />
            <div>
              <h2 className="text-base font-semibold text-[#0F172A]">声音提示</h2>
              <p className="text-xs text-[#94A3B8] mt-0.5">新订单、加餐、退款等事件触发时播放</p>
            </div>
          </div>
          <Toggle checked={pref.sound_enabled} onChange={handleToggleSoundEnabled} label={pref.sound_enabled ? '已开启' : '已关闭'} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {sounds.length === 0 && (
            <div className="col-span-full text-sm text-[#94A3B8] text-center py-4">
              没有可用音色
            </div>
          )}
          {sounds.map((entry) => {
            const selected = pref.sound_id === entry.id
            const isPreviewing = previewingId === entry.id
            return (
              <button
                key={entry.id}
                disabled={!pref.sound_enabled}
                onClick={() => handleSelectSound(entry.id)}
                className={`text-left p-3 rounded-lg border-2 transition-colors ${
                  selected
                    ? 'border-[#2563EB] bg-[#EFF6FF]'
                    : 'border-[#E2E8F0] bg-white hover:border-[#CBD5E1]'
                } ${!pref.sound_enabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${selected ? 'text-[#2563EB]' : 'text-[#0F172A]'}`}>
                    {entry.label}
                  </span>
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handlePreview(entry)
                    }}
                    className="inline-flex items-center gap-1 text-xs text-[#64748B] hover:text-[#2563EB] cursor-pointer"
                  >
                    {isPreviewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    试听
                  </span>
                </div>
                <div className="text-xs text-[#94A3B8] mt-1 font-mono">
                  {(entry.durationMs / 1000).toFixed(1)} 秒
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* 桌面通知 */}
      <section className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-5">
        <div className="flex items-center gap-3 mb-4">
          <Monitor className="w-5 h-5 text-[#2563EB]" />
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">桌面通知</h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">在浏览器后台或锁屏时仍能弹出系统通知</p>
          </div>
        </div>

        <div className="space-y-2">
          {ALL_DESKTOP_EVENTS.map((e) => {
            const checked = pref.desktop_events.includes(e)
            return (
              <label
                key={e}
                className="flex items-start gap-3 p-3 rounded-lg border border-[#E2E8F0] hover:border-[#CBD5E1] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(ev) => handleToggleEvent(e, ev.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-[#CBD5E1] text-[#2563EB] focus:ring-[#2563EB]"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-[#0F172A]">{EVENT_LABEL[e]}</div>
                  <div className="text-xs text-[#94A3B8] mt-0.5">{EVENT_DESC[e]}</div>
                </div>
              </label>
            )
          })}
        </div>

        <p className="text-xs text-[#94A3B8] mt-3 flex items-center gap-1">
          <BellOff className="w-3.5 h-3.5" />
          关闭浏览器站点通知权限后，所有桌面通知都将失效；声音和页内 toast 仍会保留。
        </p>
      </section>

      {/* Web Push 推送（关浏览器、锁屏也能收） */}
      <section className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-5 mt-4">
        <div className="flex items-center gap-3 mb-4">
          <Smartphone className="w-5 h-5 text-[#2563EB]" />
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">Web Push（强力推送）</h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">即使关掉浏览器、回到桌面、锁屏也能收到通知</p>
          </div>
        </div>

        {!pushSupported ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[#FEF3C7] border border-[#FCD34D]">
            <AlertCircle className="w-4 h-4 mt-0.5 text-[#B45309] shrink-0" />
            <div className="text-sm text-[#78350F]">
              当前环境不支持 Web Push：{pushSupportReason || '未知原因'}
              <div className="text-xs mt-1 text-[#92400E]">
                建议使用 Edge / Chrome 浏览器，或将网页"添加到主屏幕"以 PWA 方式使用。
              </div>
            </div>
          </div>
        ) : pushLikelyBlocked && !pushSubscribed ? (
          // 安卓浏览器：FCM 国内被墙，前置劝退 + 引导到邮件兜底
          <div className="flex items-start gap-2 p-3 rounded-lg bg-[#FEF3C7] border border-[#FCD34D]">
            <AlertCircle className="w-4 h-4 mt-0.5 text-[#B45309] shrink-0" />
            <div className="text-sm text-[#78350F] flex-1">
              <div className="font-medium">安卓浏览器无法使用 Web Push</div>
              <div className="text-xs mt-1 text-[#92400E]">
                安卓的浏览器推送依赖 Google FCM，国内网络环境下无法连接。
                <br />
                推荐方案：
                <br />
                1️⃣ 用下方「<b>邮件兜底</b>」（订单变更通过邮件送达手机邮箱 app）
                <br />
                2️⃣ 桌面 Edge 浏览器开着 admin → ✅ 完美支持
                <br />
                3️⃣ iPhone Safari「添加到主屏幕」→ ✅ 完美支持
              </div>
              <button
                onClick={() => {
                  document.getElementById('email-fallback-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                className="mt-2 inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-[#B45309] text-white hover:bg-[#92400E]"
              >
                ↓ 去配置邮件兜底
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between p-3 rounded-lg border border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                {pushSubscribed ? (
                  <CheckCircle2 className="w-5 h-5 text-[#10B981]" />
                ) : (
                  <XCircle className="w-5 h-5 text-[#94A3B8]" />
                )}
                <div>
                  <div className="text-sm font-medium text-[#0F172A]">
                    {pushSubscribed ? '已订阅' : '未订阅'}
                  </div>
                  <div className="text-xs text-[#94A3B8]">
                    {pushSubscribed
                      ? '本设备已订阅，新订单会推送到系统通知中心'
                      : '点击右侧按钮开启强力推送'}
                  </div>
                </div>
              </div>
              {pushSubscribed ? (
                <button
                  onClick={handleDisablePush}
                  disabled={pushBusy}
                  className="px-3 py-1.5 rounded-lg bg-[#F1F5F9] text-[#475569] text-sm font-medium hover:bg-[#E2E8F0] disabled:opacity-50"
                >
                  {pushBusy ? '处理中...' : '取消订阅'}
                </button>
              ) : (
                <button
                  onClick={handleEnablePush}
                  disabled={pushBusy || permissionState === 'denied'}
                  className="px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  {pushBusy ? '处理中...' : '开启订阅'}
                </button>
              )}
            </div>

            <div className="mt-3 p-3 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] text-xs text-[#1E40AF] space-y-1">
              <div className="font-medium">国内可用性说明</div>
              <div>• Windows / macOS Edge：✅ 完美支持（微软 WNS 国内节点）</div>
              <div>• iPhone Safari（添加到主屏后）：✅ 完美支持（Apple APNs）</div>
              <div>• 安卓浏览器：⚠️ FCM 国内基本不通，建议改用「邮件兜底」</div>
            </div>
          </>
        )}
      </section>

      {/* 邮件兜底 */}
      <section id="email-fallback-section" className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-5 mt-4">
        <div className="flex items-center gap-3 mb-4">
          <Mail className="w-5 h-5 text-[#2563EB]" />
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">邮件兜底</h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              即使你不在线，订单变更也会通过邮件送达手机邮箱 app（QQ / 网易邮箱大师 / Outlook）
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">接收邮箱</label>
            <div className="flex gap-2">
              <input
                type="email"
                value={pref.email ?? ''}
                onChange={(e) => handleEmailChange(e.target.value)}
                placeholder="留空表示不接收邮件"
                className="flex-1 h-10 px-3 border border-[#E2E8F0] rounded-lg text-sm text-[#0F172A] outline-none focus:border-[#2563EB] transition-colors"
                maxLength={255}
              />
              <button
                onClick={handleSendTestEmail}
                disabled={!pref.email || testingEmail}
                className="inline-flex items-center gap-1 px-3 h-10 rounded-lg bg-[#F1F5F9] text-[#475569] text-sm font-medium hover:bg-[#E2E8F0] disabled:opacity-50 transition-colors"
              >
                {testingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                测试发送
              </button>
            </div>
            <p className="text-xs text-[#94A3B8] mt-1">
              发件 SMTP 由店主在「店铺设置 → 邮件配置」处填写；推荐 QQ 邮箱授权码 / 阿里云邮件推送。
            </p>
          </div>

          {pref.email && (
            <div>
              <label className="block text-xs font-medium text-[#475569] mb-2">订阅哪些事件</label>
              <div className="space-y-2">
                {ALL_DESKTOP_EVENTS.map((e) => {
                  const checked = pref.email_events.includes(e)
                  return (
                    <label
                      key={`email-${e}`}
                      className="flex items-start gap-3 p-3 rounded-lg border border-[#E2E8F0] hover:border-[#CBD5E1] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(ev) => handleToggleEmailEvent(e, ev.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded border-[#CBD5E1] text-[#2563EB] focus:ring-[#2563EB]"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-[#0F172A]">{EVENT_LABEL[e]}</div>
                        <div className="text-xs text-[#94A3B8] mt-0.5">{EVENT_DESC[e]}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 cursor-pointer"
    >
      <span
        className={`relative inline-block w-10 h-6 rounded-full transition-colors ${
          checked ? 'bg-[#2563EB]' : 'bg-[#CBD5E1]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </span>
      {label !== undefined && <span className="text-xs text-[#64748B]">{label}</span>}
    </button>
  )
}
