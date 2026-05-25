/**
 * 群机器人通知配置面板（钉钉 / 企业微信 / 飞书）
 *
 * 仅 owner / manager / admin 可见，由 StoreSettings 引入。
 *
 * UX 设计：
 *  - 三家 provider Tab 切换，配置彼此独立
 *  - webhook URL + secret 输入（明文，提交后端 AES 加密）
 *  - 已配置时显示"已设置（留空保持不变）"
 *  - 事件订阅复选框（NEW_ORDER / ADD_ITEM / REFUND）
 *  - "保存"+"测试发送"两个按钮
 *  - 失败状态展示：last_error + failed_count（>=5 显示告警条）
 */
import { useEffect, useState } from 'react'
import {
  Bot,
  CheckCircle,
  XCircle,
  Loader2,
  Save,
  Send,
  Trash2,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react'
import request from '@/api/request'
import { useModal } from './ModalProvider'

type Provider = 'dingtalk' | 'wecom' | 'feishu'
type RobotEvent = 'NEW_ORDER' | 'ADD_ITEM' | 'REFUND'

interface RobotConfig {
  provider: Provider
  enabled: boolean
  has_webhook: boolean
  has_secret: boolean
  events: RobotEvent[]
  last_sent_at: string | null
  last_error: string | null
  failed_count: number
}

interface FormState {
  enabled: boolean
  webhookUrl: string
  secret: string
  events: RobotEvent[]
}

const ALL_PROVIDERS: { id: Provider; label: string; emoji: string }[] = [
  { id: 'dingtalk', label: '钉钉', emoji: '🟦' },
  { id: 'wecom', label: '企业微信', emoji: '🟩' },
  { id: 'feishu', label: '飞书', emoji: '🟪' },
]

const EVENT_LABEL: Record<RobotEvent, string> = {
  NEW_ORDER: '新订单',
  ADD_ITEM: '加餐',
  REFUND: '退款',
}

const PROVIDER_GUIDE: Record<Provider, { url: string; tip: string; needsSecret: 'optional' | 'no' }> = {
  dingtalk: {
    url: 'oapi.dingtalk.com',
    tip: '钉钉群 → 群设置 → 智能群助手 → 添加机器人 → 自定义 → 加签（推荐）→ 复制 Webhook + 加签密钥',
    needsSecret: 'optional',
  },
  wecom: {
    url: 'qyapi.weixin.qq.com',
    tip: '企业微信群 → 右上角设置 → 群机器人 → 添加 → 复制 Webhook 地址（无需密钥）。客户群可拉微信用户进群，普通微信也能收到通知',
    needsSecret: 'no',
  },
  feishu: {
    url: 'open.feishu.cn',
    tip: '飞书群 → 设置 → 群机器人 → 添加机器人 → 自定义机器人 → 安全设置选「签名校验」→ 复制 Webhook + 签名密钥',
    needsSecret: 'optional',
  },
}

const ALL_EVENTS: RobotEvent[] = ['NEW_ORDER', 'ADD_ITEM', 'REFUND']

const DEFAULT_FORM: FormState = {
  enabled: true,
  webhookUrl: '',
  secret: '',
  events: ['NEW_ORDER'],
}

export default function RobotConfigPanel() {
  const { showToast, showConfirm } = useModal()
  const [active, setActive] = useState<Provider>('dingtalk')
  const [configs, setConfigs] = useState<Record<Provider, RobotConfig | null>>({
    dingtalk: null,
    wecom: null,
    feishu: null,
  })
  const [forms, setForms] = useState<Record<Provider, FormState>>({
    dingtalk: { ...DEFAULT_FORM },
    wecom: { ...DEFAULT_FORM },
    feishu: { ...DEFAULT_FORM },
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [showWebhook, setShowWebhook] = useState(false)

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadAll = async () => {
    setLoading(true)
    try {
      const res: any = await request.get('/notif/robots')
      const list: RobotConfig[] = res?.data ?? res ?? []
      const newConfigs: Record<Provider, RobotConfig | null> = {
        dingtalk: null,
        wecom: null,
        feishu: null,
      }
      const newForms: Record<Provider, FormState> = {
        dingtalk: { ...DEFAULT_FORM },
        wecom: { ...DEFAULT_FORM },
        feishu: { ...DEFAULT_FORM },
      }
      for (const c of list) {
        newConfigs[c.provider] = c
        newForms[c.provider] = {
          enabled: c.enabled,
          webhookUrl: '', // 永远不返回明文
          secret: '',
          events: c.events.length > 0 ? c.events : ['NEW_ORDER'],
        }
      }
      setConfigs(newConfigs)
      setForms(newForms)
    } catch (err: any) {
      // 403 表示无权限，不打扰
      if (err?.response?.status !== 403) {
        showToast(err?.message || '加载机器人配置失败', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  const updateForm = (patch: Partial<FormState>) => {
    setForms((all) => ({ ...all, [active]: { ...all[active], ...patch } }))
  }

  const toggleEvent = (e: RobotEvent, checked: boolean) => {
    const cur = new Set(forms[active].events)
    if (checked) cur.add(e)
    else cur.delete(e)
    const ordered = ALL_EVENTS.filter((x) => cur.has(x))
    updateForm({ events: ordered })
  }

  const handleSave = async () => {
    const f = forms[active]
    const cfg = configs[active]
    const guide = PROVIDER_GUIDE[active]
    // 校验
    if (!cfg?.has_webhook && !f.webhookUrl) {
      return showToast('首次配置请填写 webhook URL', 'warning')
    }
    if (f.webhookUrl) {
      if (!f.webhookUrl.startsWith('https://')) {
        return showToast('webhook URL 必须以 https:// 开头', 'warning')
      }
      if (!f.webhookUrl.includes(guide.url)) {
        return showToast(`webhook URL 域名应为 ${guide.url}`, 'warning')
      }
    }
    if (f.events.length === 0) {
      return showToast('至少订阅一个事件，否则等于关闭通道', 'warning')
    }

    setSaving(true)
    try {
      const payload: any = {
        enabled: f.enabled,
        events: f.events,
      }
      if (f.webhookUrl) payload.webhook_url = f.webhookUrl
      if (guide.needsSecret !== 'no' && f.secret) payload.secret = f.secret

      const res: any = await request.put(`/notif/robots/${active}`, payload)
      const data: RobotConfig = res?.data ?? res
      setConfigs((all) => ({ ...all, [active]: data }))
      // 保存后清空输入框（明文不再持有）
      setForms((all) => ({
        ...all,
        [active]: {
          ...all[active],
          webhookUrl: '',
          secret: '',
          enabled: data.enabled,
          events: data.events,
        },
      }))
      showToast('已保存', 'success')
    } catch (err: any) {
      const msg = err?.response?.data?.msg || err?.response?.data?.message || err?.message || '保存失败'
      showToast('保存失败：' + msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    const cfg = configs[active]
    if (!cfg?.has_webhook) {
      return showToast('请先保存配置再测试', 'warning')
    }
    setTesting(true)
    try {
      const res: any = await request.post(`/notif/robots/${active}/test`, {})
      if (res?.success !== false) {
        showToast(res?.message || '测试消息已发送', 'success')
        // 测试成功后刷新一下状态（last_sent_at / failed_count 会变）
        loadAll()
      } else {
        showToast(res?.message || '测试失败', 'error')
        loadAll()
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '测试失败'
      showToast(msg, 'error')
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = () => {
    showConfirm(
      '确认删除',
      `确定删除${ALL_PROVIDERS.find((p) => p.id === active)?.label}的机器人配置？已存的 webhook URL 会被清除，需重新填写。`,
      async () => {
        try {
          await request.delete(`/notif/robots/${active}`)
          setConfigs((all) => ({ ...all, [active]: null }))
          setForms((all) => ({ ...all, [active]: { ...DEFAULT_FORM } }))
          showToast('已删除', 'success')
        } catch (err: any) {
          showToast(err?.message || '删除失败', 'error')
        }
      },
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-[#94A3B8]" />
      </div>
    )
  }

  const cfg = configs[active]
  const f = forms[active]
  const guide = PROVIDER_GUIDE[active]

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#EFF6FF] flex items-center justify-center">
          <Bot className="w-5 h-5 text-[#2563EB]" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-[#0F172A]">群机器人通知</h2>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            订单事件直接推送到钉钉/企微/飞书群，国内最稳的实时方案
          </p>
        </div>
      </div>

      {/* Provider Tabs */}
      <div className="flex gap-2 mb-5 border-b border-[#E2E8F0]">
        {ALL_PROVIDERS.map((p) => {
          const isActive = active === p.id
          const c = configs[p.id]
          const configured = c?.has_webhook
          return (
            <button
              key={p.id}
              onClick={() => setActive(p.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 -mb-px border-b-2 text-sm transition-colors ${
                isActive
                  ? 'border-[#2563EB] text-[#2563EB] font-medium'
                  : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <span>{p.emoji}</span>
              <span>{p.label}</span>
              {configured && (
                <span
                  className={`ml-1 inline-block w-2 h-2 rounded-full ${
                    c?.enabled ? 'bg-[#10B981]' : 'bg-[#94A3B8]'
                  }`}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* 配置指引 */}
      <div className="p-3 mb-4 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#64748B]">
        <div className="font-medium text-[#475569] mb-1">如何获取 Webhook</div>
        <div>{guide.tip}</div>
      </div>

      {/* 失败告警 */}
      {cfg && cfg.failed_count >= 5 && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2]">
          <AlertCircle className="w-4 h-4 mt-0.5 text-[#DC2626] shrink-0" />
          <div className="text-sm text-[#991B1B] flex-1">
            <div className="font-medium">连续 {cfg.failed_count} 次发送失败</div>
            <div className="text-xs mt-1">最近错误：{cfg.last_error}</div>
            <div className="text-xs mt-1 text-[#64748B]">检查 webhook URL 是否还有效，或重新生成。</div>
          </div>
        </div>
      )}

      {/* 启用开关 */}
      <div className="flex items-center justify-between p-3 mb-4 rounded-lg border border-[#E2E8F0]">
        <div className="flex items-center gap-2">
          {f.enabled ? (
            <CheckCircle className="w-5 h-5 text-[#10B981]" />
          ) : (
            <XCircle className="w-5 h-5 text-[#94A3B8]" />
          )}
          <div>
            <div className="text-sm font-medium text-[#0F172A]">
              {f.enabled ? '已启用' : '已禁用'}
            </div>
            <div className="text-xs text-[#94A3B8]">
              {cfg?.last_sent_at
                ? `最后发送：${new Date(cfg.last_sent_at).toLocaleString('zh-CN')}`
                : cfg?.has_webhook
                  ? '尚未发送过'
                  : '尚未配置'}
            </div>
          </div>
        </div>
        <Toggle checked={f.enabled} onChange={(v) => updateForm({ enabled: v })} />
      </div>

      {/* webhook URL */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-[#475569] mb-1">
          Webhook URL
          {cfg?.has_webhook && (
            <span className="ml-2 text-[#10B981] inline-flex items-center gap-1">
              <CheckCircle size={12} /> 已设置（留空保持不变）
            </span>
          )}
        </label>
        <div className="relative">
          <input
            type={showWebhook ? 'text' : 'password'}
            value={f.webhookUrl}
            onChange={(e) => updateForm({ webhookUrl: e.target.value })}
            placeholder={
              cfg?.has_webhook
                ? '••••••••（如需更换请输入新 URL）'
                : `https://${guide.url}/...`
            }
            className="w-full h-10 pl-3 pr-10 border border-[#E2E8F0] rounded-lg text-sm outline-none focus:border-[#2563EB] font-mono"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowWebhook((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#94A3B8] hover:text-[#475569]"
          >
            {showWebhook ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {/* 签名密钥（钉钉/飞书可选） */}
      {guide.needsSecret !== 'no' && (
        <div className="mb-4">
          <label className="block text-xs font-medium text-[#475569] mb-1">
            签名密钥（可选，强烈推荐）
            {cfg?.has_secret && (
              <span className="ml-2 text-[#10B981] inline-flex items-center gap-1">
                <CheckCircle size={12} /> 已设置（留空保持不变）
              </span>
            )}
          </label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={f.secret}
              onChange={(e) => updateForm({ secret: e.target.value })}
              placeholder={
                cfg?.has_secret
                  ? '••••••••（如需更换请输入新值）'
                  : active === 'dingtalk'
                    ? 'SEC...'
                    : '签名密钥'
              }
              className="w-full h-10 pl-3 pr-10 border border-[#E2E8F0] rounded-lg text-sm outline-none focus:border-[#2563EB]"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#94A3B8] hover:text-[#475569]"
            >
              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="text-xs text-[#94A3B8] mt-1">
            添加机器人时勾选「加签」获取，比 IP 白名单灵活；服务器 IP 变化也不影响
          </p>
        </div>
      )}

      {/* 事件订阅 */}
      <div className="mb-5">
        <label className="block text-xs font-medium text-[#475569] mb-2">订阅哪些事件</label>
        <div className="grid grid-cols-3 gap-2">
          {ALL_EVENTS.map((e) => {
            const checked = f.events.includes(e)
            return (
              <label
                key={e}
                className={`flex items-center justify-center gap-1.5 p-2.5 rounded-lg border-2 cursor-pointer transition-colors ${
                  checked
                    ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]'
                    : 'border-[#E2E8F0] bg-white text-[#475569] hover:border-[#CBD5E1]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(ev) => toggleEvent(e, ev.target.checked)}
                  className="hidden"
                />
                <span className="text-sm font-medium">{EVENT_LABEL[e]}</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          保存
        </button>
        <button
          onClick={handleTest}
          disabled={testing || !cfg?.has_webhook}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#10B981] text-white text-sm font-medium hover:bg-[#059669] disabled:opacity-50"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          测试发送
        </button>
        {cfg?.has_webhook && (
          <button
            onClick={handleDelete}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#F1F5F9] text-[#DC2626] text-sm font-medium hover:bg-[#FEF2F2]"
          >
            <Trash2 className="w-4 h-4" />
            删除
          </button>
        )}
      </div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative inline-block w-10 h-6 cursor-pointer"
    >
      <span
        className={`absolute inset-0 rounded-full transition-colors ${
          checked ? 'bg-[#2563EB]' : 'bg-[#CBD5E1]'
        }`}
      />
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  )
}
