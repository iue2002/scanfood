import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Code2, Eye, FileText, Loader2, RotateCcw, Save, Sparkles } from 'lucide-react'
import request from '@/api/request'
import { useModal } from '@/components/ModalProvider'

type TemplateEvent = 'NEW_ORDER' | 'ADD_ITEM' | 'REFUND'
type TemplateChannel = 'dingtalk' | 'wecom' | 'feishu' | 'email'
type EditorTarget = 'title_template' | 'body_template' | 'html_template'

const EVENTS: { key: TemplateEvent; label: string; hint: string }[] = [
  { key: 'NEW_ORDER', label: '新订单', hint: '客人首次提交订单时发送' },
  { key: 'ADD_ITEM', label: '加菜', hint: '订单追加菜品时发送' },
  { key: 'REFUND', label: '退款', hint: '收到退款申请时发送' },
]

const CHANNELS: { key: TemplateChannel; label: string; format: string }[] = [
  { key: 'dingtalk', label: '钉钉', format: 'Markdown' },
  { key: 'wecom', label: '企微', format: 'Markdown' },
  { key: 'feishu', label: '飞书', format: 'Markdown' },
  { key: 'email', label: '邮件', format: '文本 / HTML' },
]

interface TemplateRow {
  id?: number
  event_type: TemplateEvent
  channel: TemplateChannel
  title_template: string
  body_template: string
  html_template: string | null
  updated_at?: string
  updated_by?: number
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

interface PreviewData {
  source: 'custom' | 'default'
  rendered: { title: string; body: string; html: string | null }
  unknownVariables: string[]
}

const emptyForm: FormState = { title_template: '', body_template: '', html_template: '' }

function templateKey(event: TemplateEvent, channel: TemplateChannel) {
  return `${event}|${channel}`
}

function formFromTemplate(tpl?: TemplateRow | null): FormState {
  return {
    title_template: tpl?.title_template ?? '',
    body_template: tpl?.body_template ?? '',
    html_template: tpl?.html_template ?? '',
  }
}

function sameForm(a: FormState, b: FormState) {
  return a.title_template === b.title_template && a.body_template === b.body_template && a.html_template === b.html_template
}

export default function NotifTemplatePanel() {
  const { showToast, showConfirm } = useModal()
  const [loading, setLoading] = useState(true)
  const [activeEvent, setActiveEvent] = useState<TemplateEvent>('NEW_ORDER')
  const [activeChannel, setActiveChannel] = useState<TemplateChannel>('dingtalk')
  const [templates, setTemplates] = useState<Record<string, TemplateRow>>({})
  const [defaults, setDefaults] = useState<Record<TemplateEvent, Record<TemplateChannel, TemplateRow>> | null>(null)
  const [variables, setVariables] = useState<TemplateVariable[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [editorTarget, setEditorTarget] = useState<EditorTarget>('body_template')
  const [showDefault, setShowDefault] = useState(false)

  const titleRef = useRef<HTMLInputElement | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const htmlRef = useRef<HTMLTextAreaElement | null>(null)

  const currentKey = templateKey(activeEvent, activeChannel)
  const customTemplate = templates[currentKey]
  const savedForm = useMemo(() => formFromTemplate(customTemplate), [customTemplate])
  const defaultTemplate = defaults?.[activeEvent]?.[activeChannel]
  const defaultForm = useMemo(() => formFromTemplate(defaultTemplate), [defaultTemplate])
  const isDirty = !sameForm(form, savedForm)
  const visibleVariables = variables.filter(v => v.scope === 'all' || activeChannel === 'email')
  const activeEventMeta = EVENTS.find(e => e.key === activeEvent)
  const activeChannelMeta = CHANNELS.find(ch => ch.key === activeChannel)

  useEffect(() => {
    Promise.all([
      request.get('/notif/templates'),
      request.get('/notif/templates/variables'),
      request.get('/notif/templates/defaults'),
    ]).then(([tRes, vRes, dRes]: any[]) => {
      const rows: TemplateRow[] = (tRes?.data ?? tRes) || []
      const map: Record<string, TemplateRow> = {}
      rows.forEach((r) => { map[templateKey(r.event_type, r.channel)] = r })
      setTemplates(map)
      setVariables((vRes?.data ?? vRes) || [])
      setDefaults((dRes?.data ?? dRes) || null)
    }).catch((err: any) => {
      showToast(err?.message || '加载消息模板失败', 'error')
    }).finally(() => setLoading(false))
  }, [showToast])

  useEffect(() => {
    setForm(formFromTemplate(customTemplate))
  }, [customTemplate, activeEvent, activeChannel])

  useEffect(() => {
    if (loading) return
    const timer = window.setTimeout(() => {
      void loadPreview()
    }, 250)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, activeEvent, activeChannel, form.title_template, form.body_template, form.html_template, variables.length])

  const loadPreview = async () => {
    setPreviewLoading(true)
    try {
      const res: any = await request.post('/notif/templates/preview', {
        event_type: activeEvent,
        channel: activeChannel,
        title_template: form.title_template || undefined,
        body_template: form.body_template || undefined,
        html_template: activeChannel === 'email' ? (form.html_template || null) : null,
        allowed_variables: visibleVariables.map(v => v.name),
      })
      setPreview(res?.data ?? res)
    } catch (err: any) {
      showToast(err?.message || '预览生成失败', 'error')
    } finally {
      setPreviewLoading(false)
    }
  }

  const switchSelection = (nextEvent: TemplateEvent, nextChannel: TemplateChannel) => {
    const apply = () => {
      setActiveEvent(nextEvent)
      setActiveChannel(nextChannel)
      setEditorTarget('body_template')
      setShowDefault(false)
    }
    if (!isDirty) {
      apply()
      return
    }
    showConfirm('放弃未保存修改？', '当前模板还有未保存内容，切换后会恢复为已保存版本。', apply)
  }

  const handleSave = async () => {
    if (!form.title_template.trim()) return showToast('请填写标题模板', 'warning')
    if (!form.body_template.trim()) return showToast('请填写内容模板', 'warning')
    if (preview?.unknownVariables?.length) return showToast(`存在未知变量：${preview.unknownVariables.join('、')}`, 'warning')

    setSaving(true)
    try {
      const res: any = await request.put('/notif/templates', {
        event_type: activeEvent,
        channel: activeChannel,
        title_template: form.title_template.trim(),
        body_template: form.body_template.trim(),
        html_template: activeChannel === 'email' ? (form.html_template.trim() || null) : null,
      })
      const saved: TemplateRow = res?.data ?? res
      setTemplates(prev => ({ ...prev, [currentKey]: saved }))
      setForm(formFromTemplate(saved))
      showToast('模板已保存', 'success')
    } catch (err: any) {
      showToast(err?.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    showConfirm('恢复系统默认模板', '自定义模板会被删除，后续通知将使用系统默认内容。', async () => {
      try {
        await request.delete('/notif/templates', { params: { event_type: activeEvent, channel: activeChannel } })
        setTemplates(prev => { const next = { ...prev }; delete next[currentKey]; return next })
        setForm(emptyForm)
        showToast('已恢复默认模板', 'success')
      } catch (err: any) {
        showToast(err?.message || '操作失败', 'error')
      }
    })
  }

  const copyDefault = () => {
    setForm(defaultForm)
    setEditorTarget('body_template')
    showToast('已填入系统默认模板，可继续修改后保存', 'info')
  }

  const insertVar = (name: string) => {
    const token = `{{${name}}}`
    const ref = editorTarget === 'title_template' ? titleRef.current : editorTarget === 'html_template' ? htmlRef.current : bodyRef.current
    setForm(prev => {
      const current = prev[editorTarget]
      const start = ref?.selectionStart ?? current.length
      const end = ref?.selectionEnd ?? current.length
      return { ...prev, [editorTarget]: current.slice(0, start) + token + current.slice(end) }
    })
    window.setTimeout(() => {
      ref?.focus()
      const pos = (ref?.selectionStart ?? 0) + token.length
      ref?.setSelectionRange(pos, pos)
    }, 0)
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-[#2563EB]" />
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">自定义消息模板</h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">机器人通知和邮件共用这套模板，保存前先看右侧预览。</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md ${customTemplate ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#F1F5F9] text-[#64748B]'}`}>
            {customTemplate ? <CheckCircle2 size={13} /> : <Sparkles size={13} />}
            {customTemplate ? '当前为自定义模板' : '当前使用系统默认'}
          </span>
          {isDirty && <span className="px-2 py-1 rounded-md bg-[#FEF3C7] text-[#A16207]">未保存</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[230px_minmax(0,1fr)_360px] gap-4">
        <div className="space-y-4">
          <div>
            <div className="text-xs font-medium text-[#64748B] mb-2">事件</div>
            <div className="space-y-1.5">
              {EVENTS.map((e) => (
                <button
                  key={e.key}
                  onClick={() => switchSelection(e.key, activeChannel)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                    activeEvent === e.key ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E2E8F0] hover:border-[#CBD5E1]'
                  }`}
                >
                  <div className="text-sm font-medium text-[#0F172A]">{e.label}</div>
                  <div className="text-[11px] text-[#94A3B8] mt-0.5">{e.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-[#64748B] mb-2">渠道</div>
            <div className="grid grid-cols-2 xl:grid-cols-1 gap-1.5">
              {CHANNELS.map((ch) => {
                const hasCustom = !!templates[templateKey(activeEvent, ch.key)]
                return (
                  <button
                    key={ch.key}
                    onClick={() => switchSelection(activeEvent, ch.key)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
                      activeChannel === ch.key ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E2E8F0] hover:border-[#CBD5E1]'
                    }`}
                  >
                    <span>
                      <span className="block text-sm font-medium text-[#0F172A]">{ch.label}</span>
                      <span className="block text-[11px] text-[#94A3B8]">{ch.format}</span>
                    </span>
                    {hasCustom && <span className="w-2 h-2 rounded-full bg-[#10B981]" />}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-[#0F172A]">{activeEventMeta?.label} · {activeChannelMeta?.label}</div>
              <div className="text-xs text-[#94A3B8]">变量格式支持 <span className="font-mono">{'{{变量名}}'}</span> 和 <span className="font-mono">{'{{ 变量名 }}'}</span></div>
            </div>
            <button onClick={copyDefault} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E2E8F0] text-xs text-[#334155] hover:bg-[#F8FAFC] cursor-pointer">
              <Code2 size={14} />
              填入默认
            </button>
          </div>

          <Field label="标题模板" active={editorTarget === 'title_template'}>
            <input
              ref={titleRef}
              type="text"
              value={form.title_template}
              onFocus={() => setEditorTarget('title_template')}
              onChange={(e) => setForm(f => ({ ...f, title_template: e.target.value }))}
              placeholder={defaultForm.title_template || '填写通知标题'}
              className="w-full h-10 px-3 border border-[#E2E8F0] rounded-lg text-sm font-mono outline-none focus:border-[#2563EB] transition-colors"
              maxLength={500}
            />
          </Field>

          <Field label={activeChannel === 'email' ? '纯文本内容' : 'Markdown 内容'} active={editorTarget === 'body_template'}>
            <textarea
              ref={bodyRef}
              value={form.body_template}
              onFocus={() => setEditorTarget('body_template')}
              onChange={(e) => setForm(f => ({ ...f, body_template: e.target.value }))}
              placeholder={defaultForm.body_template || '填写消息内容'}
              className="w-full min-h-[220px] px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm font-mono resize-y outline-none focus:border-[#2563EB] transition-colors"
              maxLength={10000}
            />
          </Field>

          {activeChannel === 'email' && (
            <Field label="HTML 内容（可选）" active={editorTarget === 'html_template'}>
              <textarea
                ref={htmlRef}
                value={form.html_template}
                onFocus={() => setEditorTarget('html_template')}
                onChange={(e) => setForm(f => ({ ...f, html_template: e.target.value }))}
                placeholder="留空则发送纯文本内容"
                className="w-full min-h-[140px] px-3 py-2 border border-[#E2E8F0] rounded-lg text-xs font-mono resize-y outline-none focus:border-[#2563EB] transition-colors"
                maxLength={50000}
              />
            </Field>
          )}

          <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs font-medium text-[#64748B]">可用变量</div>
              <div className="text-[11px] text-[#94A3B8]">点击插入到当前编辑框</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {visibleVariables.map((v) => (
                <button
                  key={v.name}
                  onClick={() => insertVar(v.name)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-[#E2E8F0] text-xs text-[#2563EB] hover:bg-[#EFF6FF] cursor-pointer"
                  title={`{{${v.name}}} - ${v.description}`}
                >
                  {v.description}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !isDirty || !!preview?.unknownVariables?.length}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors cursor-pointer"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              保存模板
            </button>
            {customTemplate && (
              <button onClick={handleReset} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#F1F5F9] text-[#DC2626] text-sm font-medium hover:bg-[#E2E8F0] transition-colors cursor-pointer">
                <RotateCcw className="w-4 h-4" />
                恢复默认
              </button>
            )}
            {preview?.unknownVariables?.length ? (
              <span className="inline-flex items-center gap-1 text-xs text-[#DC2626]"><AlertCircle size={14} />未知变量：{preview.unknownVariables.join('、')}</span>
            ) : preview && (
              <span className="inline-flex items-center gap-1 text-xs text-[#047857]"><CheckCircle2 size={14} />变量检查通过</span>
            )}
          </div>
        </div>

        <div className="space-y-3 min-w-0">
          <div className="rounded-lg border border-[#E2E8F0] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#475569]"><Eye size={14} />发送预览</span>
              {previewLoading && <Loader2 className="w-4 h-4 animate-spin text-[#94A3B8]" />}
            </div>
            <div className="p-3 bg-white min-h-[260px]">
              <div className="text-xs text-[#94A3B8] mb-1">标题</div>
              <div className="text-sm font-semibold text-[#0F172A] whitespace-pre-wrap break-words mb-3">{preview?.rendered.title || defaultForm.title_template || '-'}</div>
              <div className="text-xs text-[#94A3B8] mb-1">内容</div>
              <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-[#334155] font-mono bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3 max-h-[320px] overflow-auto">{preview?.rendered.body || defaultForm.body_template || '-'}</pre>
              {activeChannel === 'email' && (preview?.rendered.html || form.html_template) && (
                <>
                  <div className="text-xs text-[#94A3B8] mt-3 mb-1">HTML</div>
                  <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-[#334155] font-mono bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3 max-h-[180px] overflow-auto">{preview?.rendered.html || '-'}</pre>
                </>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[#E2E8F0] overflow-hidden">
            <button onClick={() => setShowDefault(v => !v)} className="w-full flex items-center justify-between px-3 py-2 bg-[#F8FAFC] text-xs font-medium text-[#475569] cursor-pointer">
              <span>系统默认模板</span>
              <span>{showDefault ? '收起' : '查看'}</span>
            </button>
            {showDefault && (
              <div className="p-3 space-y-2 bg-white">
                <ReadonlyBlock label="标题" value={defaultForm.title_template} />
                <ReadonlyBlock label="内容" value={defaultForm.body_template} />
                {activeChannel === 'email' && defaultForm.html_template && <ReadonlyBlock label="HTML" value={defaultForm.html_template} />}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function Field({ label, active, children }: { label: string; active: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label className="block text-xs font-medium text-[#475569]">{label}</label>
        {active && <span className="text-[11px] text-[#2563EB]">变量将插入这里</span>}
      </div>
      {children}
    </div>
  )
}

function ReadonlyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-[#94A3B8] mb-1">{label}</div>
      <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-2 max-h-[180px] overflow-auto">{value || '-'}</pre>
    </div>
  )
}
