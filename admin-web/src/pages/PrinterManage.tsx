import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Edit,
  Eye,
  Loader2,
  Monitor,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
  WifiOff,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import request from '@/api/request'
import { useModal } from '@/components/ModalProvider'

type Provider = 'FEIE' | 'BLUETOOTH' | 'BROWSER'
type RoleType = 'CASHIER' | 'KITCHEN' | 'BOTH'
type Width = '58mm' | '80mm'

const ALL_FIELDS = ['STORE_NAME', 'TABLE_NUMBER', 'ITEMS', 'TOTAL', 'TIME', 'ORDER_NO', 'REMARK', 'OPERATOR'] as const
const REQUIRED_FIELDS = ['TABLE_NUMBER', 'ITEMS', 'TOTAL'] as const
type Field = typeof ALL_FIELDS[number]

const FIELD_LABEL: Record<Field, string> = {
  STORE_NAME: '店名',
  TABLE_NUMBER: '桌号',
  ITEMS: '菜品明细',
  TOTAL: '合计',
  TIME: '时间',
  ORDER_NO: '订单号',
  REMARK: '备注',
  OPERATOR: '操作员',
}

const PROVIDER_LABEL: Record<Provider, string> = {
  FEIE: '飞鹅云',
  BLUETOOTH: '蓝牙',
  BROWSER: '浏览器',
}

const ROLE_LABEL: Record<RoleType, string> = {
  CASHIER: '前台收银',
  KITCHEN: '后厨',
  BOTH: '前台 + 后厨',
}

interface Printer {
  id: number
  name: string
  provider: Provider
  device_sn: string | null
  has_device_key: boolean
  role: RoleType
  enabled: boolean
  auto_print: boolean
  auto_print_add_more: boolean
  template_id: number | null
  online?: boolean
  last_online_at: string | null
}

interface Template {
  id: number
  name: string
  fields_json: Field[]
  width: Width
}

interface PrintJob {
  id: number
  printer_id: number
  order_id: number | null
  trigger: 'NEW_ORDER' | 'ADD_MORE' | 'REPRINT' | 'TEST'
  status: 'PENDING' | 'SENT' | 'SUCCESS' | 'FAILED'
  attempt: number
  last_error: string | null
  next_retry_at: string | null
  provider_job_id: string | null
  created_at: string
  completed_at: string | null
}

const TRIGGER_LABEL: Record<PrintJob['trigger'], string> = {
  NEW_ORDER: '新订单',
  ADD_MORE: '加餐',
  REPRINT: '补打',
  TEST: '试打印',
}

const STATUS_LABEL: Record<PrintJob['status'], { label: string; cls: string }> = {
  PENDING: { label: '待派发', cls: 'bg-[#FEF3C7] text-[#92400E]' },
  SENT: { label: '已下发', cls: 'bg-[#EFF6FF] text-[#1E40AF]' },
  SUCCESS: { label: '成功', cls: 'bg-[#D1FAE5] text-[#065F46]' },
  FAILED: { label: '失败', cls: 'bg-[#FEE2E2] text-[#991B1B]' },
}

export default function PrinterManage() {
  const { showToast, showConfirm } = useModal()
  const [printers, setPrinters] = useState<Printer[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editPrinter, setEditPrinter] = useState<Printer | 'new' | null>(null)
  const [editTemplate, setEditTemplate] = useState<Template | 'new' | null>(null)
  const [jobsView, setJobsView] = useState<Printer | null>(null)

  const refreshAll = useCallback(async () => {
    setLoading(true)
    try {
      const [pr, tp]: any[] = await Promise.all([
        request.get('/merchant-ops/printers'),
        request.get('/merchant-ops/print-templates'),
      ])
      setPrinters((pr?.data ?? pr) as Printer[])
      setTemplates((tp?.data ?? tp) as Template[])
    } catch (err: any) {
      showToast(err?.message || '加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { refreshAll() }, [refreshAll])

  const handleTestPrint = async (printer: Printer) => {
    try {
      const res: any = await request.post(`/merchant-ops/printers/${printer.id}/test-print`)
      const data = res?.data ?? res
      if (data?.accepted) {
        showToast('试打印任务已下发', 'success')
      } else {
        showToast(`试打印失败：${data?.errorCode ?? '未知错误'}`, 'error')
      }
    } catch (err: any) {
      showToast(err?.message || '试打印失败', 'error')
    }
  }

  const handleToggleAutoPrint = async (printer: Printer, key: 'auto_print' | 'auto_print_add_more', value: boolean) => {
    try {
      const res: any = await request.patch(`/merchant-ops/printers/${printer.id}/auto-print`, { [key]: value })
      const updated = (res?.data ?? res) as Printer
      setPrinters((list) => list.map((p) => p.id === updated.id ? updated : p))
    } catch (err: any) {
      showToast(err?.message || '切换失败', 'error')
    }
  }

  const handleDelete = async (printer: Printer) => {
    showConfirm(`确定删除打印机「${printer.name}」？此操作不可撤销`, async () => {
      try {
        await request.delete(`/merchant-ops/printers/${printer.id}`)
        showToast('已删除', 'success')
        await refreshAll()
      } catch (err: any) {
        showToast(err?.message || '删除失败', 'error')
      }
    })
  }

  const templateMap = useMemo(() => {
    const m = new Map<number, Template>()
    for (const t of templates) m.set(t.id, t)
    return m
  }, [templates])

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
            <Printer className="w-5 h-5 text-[#2563EB]" />
          </div>
          <div>
            <h1 className="text-lg lg:text-xl font-semibold text-[#0F172A]">打印设置</h1>
            <p className="text-xs text-[#94A3B8] mt-0.5">飞鹅云 / 浏览器打印 · 模板编辑 · 自动打印 · 离线重试</p>
          </div>
        </div>
        <button
          onClick={refreshAll}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-[#E2E8F0] text-sm text-[#334155] hover:bg-[#F1F5F9] transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {/* 打印机列表 */}
      <section className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#0F172A]">打印机</h2>
          <button
            onClick={() => setEditPrinter('new')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] transition-colors"
          >
            <Plus className="w-4 h-4" />
            新增打印机
          </button>
        </div>

        {printers.length === 0 ? (
          <div className="text-center py-12 text-[#94A3B8]">
            <Printer className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">还没有配置打印机</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {printers.map((p) => (
              <PrinterCard
                key={p.id}
                printer={p}
                templateName={p.template_id ? templateMap.get(p.template_id)?.name ?? `模板#${p.template_id}` : '默认'}
                onEdit={() => setEditPrinter(p)}
                onDelete={() => handleDelete(p)}
                onTestPrint={() => handleTestPrint(p)}
                onToggleAutoPrint={(k, v) => handleToggleAutoPrint(p, k, v)}
                onViewJobs={() => setJobsView(p)}
              />
            ))}
          </div>
        )}
      </section>

      {/* 模板列表 */}
      <section className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#0F172A]">打印模板</h2>
          <button
            onClick={() => setEditTemplate('new')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] transition-colors"
          >
            <Plus className="w-4 h-4" />
            新增模板
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => setEditTemplate(t)}
              className="text-left p-4 rounded-lg border border-[#E2E8F0] bg-white hover:border-[#2563EB] hover:shadow transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-[#0F172A]">{t.name}</span>
                <span className="text-xs text-[#94A3B8]">{t.width}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {t.fields_json.map((f) => (
                  <span key={f} className="px-1.5 py-0.5 text-xs rounded bg-[#F1F5F9] text-[#475569]">
                    {FIELD_LABEL[f]}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </section>

      {editPrinter && (
        <PrinterEditDialog
          target={editPrinter}
          templates={templates}
          onClose={() => setEditPrinter(null)}
          onSaved={() => { setEditPrinter(null); refreshAll() }}
        />
      )}
      {editTemplate && (
        <TemplateEditDialog
          target={editTemplate}
          onClose={() => setEditTemplate(null)}
          onSaved={() => { setEditTemplate(null); refreshAll() }}
        />
      )}
      {jobsView && (
        <JobsDialog printer={jobsView} onClose={() => setJobsView(null)} />
      )}
    </div>
  )
}

function PrinterCard({
  printer, templateName, onEdit, onDelete, onTestPrint, onToggleAutoPrint, onViewJobs,
}: {
  printer: Printer
  templateName: string
  onEdit: () => void
  onDelete: () => void
  onTestPrint: () => void
  onToggleAutoPrint: (k: 'auto_print' | 'auto_print_add_more', v: boolean) => void
  onViewJobs: () => void
}) {
  const Icon = printer.provider === 'FEIE' ? Cloud : printer.provider === 'BROWSER' ? Monitor : Printer
  return (
    <div className="p-4 rounded-lg border border-[#E2E8F0] bg-white">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-[#2563EB]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-[#0F172A]">{printer.name}</span>
              <OnlineDot online={printer.online} />
            </div>
            <div className="text-xs text-[#94A3B8] mt-0.5">
              {PROVIDER_LABEL[printer.provider]} · {ROLE_LABEL[printer.role]} · 模板：{templateName}
              {printer.device_sn && <> · SN: <span className="font-mono">{printer.device_sn}</span></>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <IconBtn onClick={onTestPrint} title="试打印"><Zap className="w-4 h-4" /></IconBtn>
          <IconBtn onClick={onViewJobs} title="任务列表"><Activity className="w-4 h-4" /></IconBtn>
          <IconBtn onClick={onEdit} title="编辑"><Edit className="w-4 h-4" /></IconBtn>
          <IconBtn onClick={onDelete} title="删除" red><Trash2 className="w-4 h-4" /></IconBtn>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ToggleRow
          label="新单自动打印"
          checked={printer.auto_print}
          disabled={!printer.enabled}
          onChange={(v) => onToggleAutoPrint('auto_print', v)}
        />
        <ToggleRow
          label="加餐自动打印"
          checked={printer.auto_print_add_more}
          disabled={!printer.enabled}
          onChange={(v) => onToggleAutoPrint('auto_print_add_more', v)}
        />
      </div>
    </div>
  )
}

function OnlineDot({ online }: { online?: boolean }) {
  if (online === true) return <span className="inline-flex items-center gap-1 text-xs text-[#16A34A]"><CheckCircle2 className="w-3.5 h-3.5" />在线</span>
  if (online === false) return <span className="inline-flex items-center gap-1 text-xs text-[#DC2626]"><WifiOff className="w-3.5 h-3.5" />离线</span>
  return <span className="text-xs text-[#94A3B8]">未知</span>
}

function IconBtn({ children, onClick, title, red }: { children: React.ReactNode; onClick: () => void; title?: string; red?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded hover:bg-[#F1F5F9] cursor-pointer ${red ? 'text-[#DC2626] hover:bg-[#FEE2E2]' : 'text-[#475569]'}`}
    >
      {children}
    </button>
  )
}

function ToggleRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between p-2 rounded border border-[#E2E8F0] cursor-pointer disabled:opacity-50"
    >
      <span className="text-sm text-[#334155]">{label}</span>
      <span className={`relative inline-block w-9 h-5 rounded-full transition-colors ${checked ? 'bg-[#2563EB]' : 'bg-[#CBD5E1]'}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  )
}

// ============================================================
// 打印机编辑弹窗
// ============================================================
function PrinterEditDialog({
  target, templates, onClose, onSaved,
}: {
  target: Printer | 'new'
  templates: Template[]
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useModal()
  const isNew = target === 'new'
  const initial = isNew ? null : target as Printer
  const [name, setName] = useState(initial?.name ?? '')
  const [provider, setProvider] = useState<Provider>(initial?.provider ?? 'FEIE')
  const [deviceSn, setDeviceSn] = useState(initial?.device_sn ?? '')
  const [deviceKey, setDeviceKey] = useState('')
  const [role, setRole] = useState<RoleType>(initial?.role ?? 'BOTH')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [autoPrint, setAutoPrint] = useState(initial?.auto_print ?? false)
  const [autoPrintAdd, setAutoPrintAdd] = useState(initial?.auto_print_add_more ?? false)
  const [templateId, setTemplateId] = useState<number | null>(initial?.template_id ?? (templates[0]?.id ?? null))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) { showToast('名称不能为空', 'warning'); return }
    if (provider === 'FEIE' && !deviceSn.trim()) { showToast('飞鹅打印机必须填 SN', 'warning'); return }
    if (provider === 'FEIE' && isNew && !deviceKey.trim()) { showToast('飞鹅打印机必须填密钥', 'warning'); return }
    setSaving(true)
    try {
      const body: any = {
        name: name.trim(),
        provider,
        device_sn: deviceSn.trim() || null,
        role,
        enabled,
        auto_print: autoPrint,
        auto_print_add_more: autoPrintAdd,
        template_id: templateId,
      }
      if (deviceKey) body.device_key_plain = deviceKey
      if (isNew) {
        await request.post('/merchant-ops/printers', body)
        showToast('已新增', 'success')
      } else {
        await request.patch(`/merchant-ops/printers/${(target as Printer).id}`, body)
        showToast('已更新', 'success')
      }
      onSaved()
    } catch (err: any) {
      showToast(err?.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title={isNew ? '新增打印机' : `编辑：${initial?.name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="名称">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="例：前台收银 / 后厨" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="品牌">
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className={inputCls}>
              <option value="FEIE">飞鹅云</option>
              <option value="BROWSER">浏览器（备用）</option>
            </select>
          </Field>
          <Field label="角色">
            <select value={role} onChange={(e) => setRole(e.target.value as RoleType)} className={inputCls}>
              <option value="BOTH">前台 + 后厨</option>
              <option value="CASHIER">前台收银</option>
              <option value="KITCHEN">后厨</option>
            </select>
          </Field>
        </div>
        {provider === 'FEIE' && (
          <>
            <Field label="飞鹅 SN">
              <input value={deviceSn} onChange={(e) => setDeviceSn(e.target.value)} className={inputCls} placeholder="飞鹅打印机背面 SN" />
            </Field>
            <Field label={isNew ? '飞鹅密钥' : '飞鹅密钥（留空保持不变）'}>
              <input
                type="password"
                value={deviceKey}
                onChange={(e) => setDeviceKey(e.target.value)}
                className={inputCls}
                placeholder={isNew ? '飞鹅打印机背面 KEY' : (initial?.has_device_key ? '已设置' : '未设置')}
              />
            </Field>
          </>
        )}
        <Field label="使用模板">
          <select
            value={templateId ?? ''}
            onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : null)}
            className={inputCls}
          >
            <option value="">默认（角色匹配）</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}（{t.width}）</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <ToggleRow label="启用" checked={enabled} onChange={setEnabled} />
          <ToggleRow label="新单自动打印" checked={autoPrint} disabled={!enabled} onChange={setAutoPrint} />
          <ToggleRow label="加餐自动打印" checked={autoPrintAdd} disabled={!enabled} onChange={setAutoPrintAdd} />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-[#E2E8F0]">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#E2E8F0] text-sm hover:bg-[#F1F5F9] cursor-pointer">取消</button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] cursor-pointer disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : '保存'}
        </button>
      </div>
    </Dialog>
  )
}

// ============================================================
// 模板编辑弹窗（含预览）
// ============================================================
function TemplateEditDialog({
  target, onClose, onSaved,
}: {
  target: Template | 'new'
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useModal()
  const isNew = target === 'new'
  const initial = isNew ? null : target as Template
  const [name, setName] = useState(initial?.name ?? '新模板')
  const [fields, setFields] = useState<Set<Field>>(new Set(initial?.fields_json ?? ['STORE_NAME', 'TABLE_NUMBER', 'ORDER_NO', 'ITEMS', 'TOTAL']))
  const [width, setWidth] = useState<Width>(initial?.width ?? '80mm')
  const [saving, setSaving] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)

  const toggleField = (f: Field) => {
    setFields((prev) => {
      const next = new Set(prev)
      if (next.has(f)) {
        if ((REQUIRED_FIELDS as ReadonlyArray<string>).includes(f)) {
          showToast(`${FIELD_LABEL[f]} 是必需字段，不能取消`, 'warning')
          return prev
        }
        next.delete(f)
      } else {
        next.add(f)
      }
      return next
    })
  }

  const handleSave = async () => {
    if (!name.trim()) { showToast('名称不能为空', 'warning'); return }
    const arr = Array.from(fields)
    setSaving(true)
    try {
      const body = { name: name.trim(), fields_json: arr, width }
      if (isNew) {
        const res: any = await request.post('/merchant-ops/print-templates', body)
        const created: Template = res?.data ?? res
        showToast('已新增', 'success')
        // 创建后立即拉取预览
        await loadPreview(created.id)
      } else {
        await request.put(`/merchant-ops/print-templates/${(target as Template).id}`, body)
        showToast('已更新', 'success')
      }
      onSaved()
    } catch (err: any) {
      showToast(err?.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const loadPreview = async (id?: number) => {
    const tid = id ?? (isNew ? null : (target as Template).id)
    if (!tid) return
    setPreviewLoading(true)
    try {
      const res: any = await request.post(`/merchant-ops/print-templates/${tid}/preview`)
      const data = res?.data ?? res
      setPreviewHtml(data?.html ?? '')
    } catch (err: any) {
      showToast(err?.message || '预览失败', 'error')
    } finally {
      setPreviewLoading(false)
    }
  }

  useEffect(() => {
    if (!isNew) loadPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Dialog title={isNew ? '新增模板' : `编辑：${initial?.name}`} onClose={onClose} large>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <Field label="模板名称">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="纸宽">
            <select value={width} onChange={(e) => setWidth(e.target.value as Width)} className={inputCls}>
              <option value="80mm">80mm</option>
              <option value="58mm">58mm</option>
            </select>
          </Field>
          <div>
            <label className="block text-xs text-[#64748B] mb-2">勾选字段（{REQUIRED_FIELDS.join('、')} 必选）</label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_FIELDS.map((f) => {
                const checked = fields.has(f)
                const required = (REQUIRED_FIELDS as ReadonlyArray<string>).includes(f)
                return (
                  <label
                    key={f}
                    className={`flex items-center gap-2 p-2 rounded border cursor-pointer ${
                      checked ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E2E8F0]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleField(f)}
                      className="w-4 h-4 rounded border-[#CBD5E1] text-[#2563EB] focus:ring-[#2563EB]"
                    />
                    <span className="text-sm text-[#334155]">{FIELD_LABEL[f]}</span>
                    {required && <span className="text-xs text-[#94A3B8]">必选</span>}
                  </label>
                )
              })}
            </div>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#64748B]">实时预览</span>
            <button
              onClick={() => loadPreview()}
              disabled={previewLoading || isNew}
              className="text-xs text-[#2563EB] hover:underline cursor-pointer inline-flex items-center gap-1 disabled:opacity-50"
            >
              {previewLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
              刷新预览
            </button>
          </div>
          <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4 overflow-auto max-h-[400px]">
            {isNew ? (
              <div className="text-xs text-[#94A3B8] text-center py-8">保存后可预览</div>
            ) : (
              <div className="ticket-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            )}
          </div>
        </div>
      </div>

      <style>{`
        .ticket-preview .ticket {
          margin: 0 auto;
          padding: 12px;
          background: #fff;
          border: 1px dashed #CBD5E1;
          border-radius: 4px;
          font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
          font-size: 12px;
          line-height: 1.5;
          color: #0F172A;
        }
        .ticket-preview .store { font-size: 16px; font-weight: bold; text-align: center; margin-bottom: 8px; }
        .ticket-preview .row { display: flex; justify-content: space-between; padding: 2px 0; }
        .ticket-preview .row.total { font-size: 14px; font-weight: bold; padding-top: 6px; }
        .ticket-preview .item { display: flex; justify-content: space-between; padding: 2px 0; }
        .ticket-preview .hr { border-top: 1px dashed #94A3B8; margin: 4px 0; }
        .ticket-preview .empty { text-align: center; color: #94A3B8; padding: 4px; }
      `}</style>

      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-[#E2E8F0]">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#E2E8F0] text-sm hover:bg-[#F1F5F9] cursor-pointer">取消</button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] cursor-pointer disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : '保存'}
        </button>
      </div>
    </Dialog>
  )
}

// ============================================================
// 打印任务列表弹窗
// ============================================================
function JobsDialog({ printer, onClose }: { printer: Printer; onClose: () => void }) {
  const { showToast } = useModal()
  const [jobs, setJobs] = useState<PrintJob[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res: any = await request.get(`/merchant-ops/printers/${printer.id}/jobs?limit=100`)
      setJobs((res?.data ?? res) as PrintJob[])
    } catch (err: any) {
      showToast(err?.message || '加载任务失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [printer.id, showToast])

  useEffect(() => { refresh() }, [refresh])

  return (
    <Dialog title={`打印任务 - ${printer.name}`} onClose={onClose} large>
      <div className="flex justify-end mb-2">
        <button onClick={refresh} className="text-xs text-[#2563EB] hover:underline cursor-pointer inline-flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> 刷新
        </button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {loading ? (
          <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[#2563EB] inline" /></div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12 text-[#94A3B8] text-sm">暂无任务</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#F8FAFC] text-[#475569] text-xs">
              <tr>
                <th className="text-left p-2">时间</th>
                <th className="text-left p-2">触发</th>
                <th className="text-left p-2">订单</th>
                <th className="text-left p-2">状态</th>
                <th className="text-left p-2">尝试</th>
                <th className="text-left p-2">错误</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-[#F1F5F9]">
                  <td className="p-2 text-xs whitespace-nowrap">{new Date(j.created_at).toLocaleString('zh-CN')}</td>
                  <td className="p-2 text-xs">{TRIGGER_LABEL[j.trigger]}</td>
                  <td className="p-2 text-xs font-mono">{j.order_id ? `#${j.order_id}` : '-'}</td>
                  <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${STATUS_LABEL[j.status].cls}`}>{STATUS_LABEL[j.status].label}</span></td>
                  <td className="p-2 text-xs">{j.attempt}</td>
                  <td className="p-2 text-xs text-[#DC2626]">{j.last_error ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Dialog>
  )
}

// ============================================================
// 通用组件
// ============================================================
function Dialog({ children, title, onClose, large }: { children: React.ReactNode; title: string; onClose: () => void; large?: boolean }) {
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-xl shadow-xl w-full ${large ? 'max-w-3xl' : 'max-w-md'} max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <h2 className="text-base font-semibold text-[#0F172A]">{title}</h2>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A] cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-[#64748B] mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none'
