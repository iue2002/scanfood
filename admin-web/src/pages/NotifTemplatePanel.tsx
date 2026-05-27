import { useEffect, useState, useMemo } from 'react'
import { FileText, Loader2, Save, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import request from '@/api/request'
import { useModal } from '@/components/ModalProvider'

type TemplateEvent = 'NEW_ORDER' | 'ADD_ITEM' | 'REFUND'
type TemplateChannel = 'dingtalk' | 'wecom' | 'feishu' | 'email'

const EVENTS: { key: TemplateEvent; label: string }[] = [
  { key: 'NEW_ORDER', label: '新订单' },
  { key: 'ADD_ITEM', label: '加菜' },
  { key: 'REFUND', label: '退款' },
]

const CHANNELS: { key: TemplateChannel; label: string }[] = [
  { key: 'dingtalk', label: '钉钉' },
  { key: 'wecom', label: '企微' },
  { key: 'feishu', label: '飞书' },
  { key: 'email', label: '邮件' },
]

interface TemplateRow {
  id: number
  event_type: TemplateEvent
  channel: TemplateChannel
  title_template: string
  body_template: string
  html_template: string | null
}

interface TemplateVariable {
  name: string
  description: string
  scope: 'all' | 'email'
}

interface FormState {
  title_template: string
  body_template: string
  html_template: string
}

export default function NotifTemplatePanel() {
  const { showToast, showConfirm } = useModal()
  const [loading, setLoading] = useState(true)
  const [activeEvent, setActiveEvent] = useState<TemplateEvent>('NEW_ORDER')
  const [activeChannel, setActiveChannel] = useState<TemplateChannel>('dingtalk')
  const [templates, setTemplates] = useState<Record<string, TemplateRow>>({})
  const [variables, setVariables] = useState<TemplateVariable[]>([])
  const [varsOpen, setVarsOpen] = useState(false)
  const [form, setForm] = useState<FormState>({ title_template: '', body_template: '', html_template: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      request.get('/notif/templates'),
      request.get('/notif/templates/variables'),
    ]).then(([tRes, vRes]: any[]) => {
      const rows: TemplateRow[] = (tRes?.data ?? tRes) || []
      const map: Record<string, TemplateRow> = {}
      rows.forEach((r) => { map[`${r.event_type}|${r.channel}`] = r })
      setTemplates(map)
      setVariables((vRes?.data ?? vRes) || [])
    }).catch(() => {
      // 403 → 非管理员，不展示任何内容
    }).finally(() => setLoading(false))
  }, [])

  const currentKey = `${activeEvent}|${activeChannel}`
  const customTemplate = templates[currentKey]
  const isDirty = useMemo(() => {
    return form.title_template !== '' || form.body_template !== '' || form.html_template !== ''
  }, [form])

  useEffect(() => {
    setForm({
      title_template: customTemplate?.title_template ?? '',
      body_template: customTemplate?.body_template ?? '',
      html_template: customTemplate?.html_template ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent, activeChannel, customTemplate])

  const handleSave = async () => {
    if (!form.title_template.trim()) return showToast('请填写标题模板', 'warning')
    if (!form.body_template.trim()) return showToast('请填写内容模板', 'warning')
    setSaving(true)
    try {
      await request.put('/notif/templates', {
        event_type: activeEvent,
        channel: activeChannel,
        title_template: form.title_template.trim(),
        body_template: form.body_template.trim(),
        html_template: activeChannel === 'email' ? (form.html_template.trim() || null) : null,
      })
      const key = `${activeEvent}|${activeChannel}`
      setTemplates(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...form, id: (prev[key] as any)?.id || 0 } as TemplateRow }))
      showToast('模板已保存', 'success')
    } catch (err: any) {
      showToast('保存失败：' + (err?.response?.data?.msg || err?.message || '未知错误'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    showConfirm('重置模板', '确认恢复为系统默认模板？自定义内容将被删除。', async () => {
      try {
        await request.delete('/notif/templates', { params: { event_type: activeEvent, channel: activeChannel } })
        const key = `${activeEvent}|${activeChannel}`
        setTemplates(prev => { const next = { ...prev }; delete next[key]; return next })
        setForm({ title_template: '', body_template: '', html_template: '' })
        showToast('已恢复默认模板', 'success')
      } catch (err: any) {
        showToast('操作失败', 'error')
      }
    })
  }

  const insertVar = (name: string) => {
    setForm(f => ({ ...f, body_template: f.body_template + `{{${name}}}` }))
  }

  if (loading) {
    return (
      <section className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-5 mb-4">
        <Loader2 className="w-5 h-5 animate-spin text-[#94A3B8]" />
      </section>
    )
  }

  return (
    <section className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-5 mb-4">
      <div className="flex items-center gap-3 mb-4">
        <FileText className="w-5 h-5 text-[#2563EB]" />
        <div>
          <h2 className="text-base font-semibold text-[#0F172A]">自定义消息模板</h2>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            自定义机器人通知和邮件的消息格式。留空时使用系统默认模板。
          </p>
        </div>
      </div>

      {/* 事件类型 Tab */}
      <div className="flex gap-1 mb-4 p-1 bg-[#F1F5F9] rounded-lg">
        {EVENTS.map((e) => (
          <button
            key={e.key}
            onClick={() => setActiveEvent(e.key)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
              activeEvent === e.key ? 'bg-white text-[#2563EB] shadow-sm' : 'text-[#64748B] hover:text-[#334155]'
            }`}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* 通道子 Tab */}
      <div className="flex gap-2 mb-4 overflow-x-auto whitespace-nowrap">
        {CHANNELS.map((ch) => {
          const key = `${activeEvent}|${ch.key}`
          const hasCustom = !!templates[key]
          return (
            <button
              key={ch.key}
              onClick={() => setActiveChannel(ch.key)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                activeChannel === ch.key
                  ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB]'
                  : 'border-[#E2E8F0] bg-white text-[#64748B] hover:border-[#CBD5E1]'
              }`}
            >
              {ch.label}
              {hasCustom && <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-[#10B981] inline-block" />}
            </button>
          )
        })}
      </div>

      {/* 表单 */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-[#475569] mb-1">标题模板</label>
          <input
            type="text"
            value={form.title_template}
            onChange={(e) => setForm(f => ({ ...f, title_template: e.target.value }))}
            placeholder="未填写时使用系统默认"
            className="w-full h-10 px-3 border border-[#E2E8F0] rounded-lg text-sm font-mono outline-none focus:border-[#2563EB] transition-colors"
            maxLength={500}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#475569] mb-1">
            {activeChannel === 'email' ? '纯文本内容' : 'Markdown 内容'}
          </label>
          <textarea
            value={form.body_template}
            onChange={(e) => setForm(f => ({ ...f, body_template: e.target.value }))}
            placeholder="未填写时使用系统默认。支持 {{变量名}} 语法。"
            className="w-full min-h-[160px] px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm font-mono resize-y outline-none focus:border-[#2563EB] transition-colors"
            maxLength={10000}
          />
        </div>

        {activeChannel === 'email' && (
          <div>
            <label className="block text-xs font-medium text-[#475569] mb-1">HTML 内容（可选）</label>
            <textarea
              value={form.html_template}
              onChange={(e) => setForm(f => ({ ...f, html_template: e.target.value }))}
              placeholder="留空则自动将纯文本转为 HTML"
              className="w-full min-h-[120px] px-3 py-2 border border-[#E2E8F0] rounded-lg text-xs font-mono resize-y outline-none focus:border-[#2563EB] transition-colors"
              maxLength={50000}
            />
          </div>
        )}

        {/* 变量参考 */}
        <div>
          <button
            onClick={() => setVarsOpen(v => !v)}
            className="inline-flex items-center gap-1 text-xs text-[#64748B] hover:text-[#334155] cursor-pointer"
          >
            {varsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            可用变量参考
          </button>
          {varsOpen && (
            <div className="mt-2 p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
              <div className="flex flex-wrap gap-1.5">
                {variables.map((v) => (
                  <button
                    key={v.name}
                    onClick={() => insertVar(v.name)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-[#E2E8F0] text-xs text-[#2563EB] hover:bg-[#EFF6FF] cursor-pointer"
                    title={`{{${v.name}}} — ${v.description}`}
                  >
                    {v.description}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[#94A3B8] mt-2">点击变量即可插入到内容模板；鼠标悬停查看标准格式</p>
            </div>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 mt-5">
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors cursor-pointer"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          保存模板
        </button>
        {customTemplate && (
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#F1F5F9] text-[#DC2626] text-sm font-medium hover:bg-[#E2E8F0] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            重置为默认
          </button>
        )}
      </div>
    </section>
  )
}
