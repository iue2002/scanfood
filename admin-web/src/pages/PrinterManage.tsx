import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Edit,
  Eye,
  Layers,
  Loader2,
  Monitor,
  Plus,
  Printer,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  WifiOff,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import request from '@/api/request'
import { useModal } from '@/components/ModalProvider'

type Provider = 'FEIE' | 'YLY' | 'ZYY' | 'XPRINTER' | 'BLUETOOTH' | 'BROWSER'
type RoleType = 'CASHIER' | 'KITCHEN' | 'BOTH'
type Width = '58mm' | '80mm'

const ALL_FIELDS = ['STORE_NAME', 'TABLE_NUMBER', 'ITEMS', 'TOTAL', 'TIME', 'ORDER_NO', 'REMARK', 'OPERATOR'] as const
// 任何模板都必须包含的最小集（前台/后厨皆然）
// TOTAL 不在此列：后厨小票按设计不打金额（顾客隐私 + 后厨无需）
const REQUIRED_FIELDS = ['TABLE_NUMBER', 'ITEMS'] as const
// 全票场景推荐勾选（CASHIER / BOTH 角色打印机引用此模板时建议有 TOTAL）
const RECOMMENDED_FOR_FULL = ['TOTAL'] as const
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
  YLY: '易联云',
  ZYY: '中易云 / 365 云打印',
  XPRINTER: '芯烨云',
  BLUETOOTH: '蓝牙',
  BROWSER: '浏览器',
}

/** 哪些 provider 是云打印（需要填 SN + 密钥） */
const CLOUD_PROVIDERS: ReadonlyArray<Provider> = ['FEIE', 'YLY', 'ZYY', 'XPRINTER']

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

// ============================================================
// 打印方案类型
// ============================================================
interface PlanSlice {
  id?: number
  printer_id: number
  template_id: number | null
  printer_role_snapshot: PrinterRoleS
  category_ids: number[] | null
  label: string
  sort_order: number
}

interface PrintPlan {
  id: number
  name: string
  enabled: boolean
  is_default_dine_in: boolean
  is_default_takeaway: boolean
  is_system_default: boolean
  description: string | null
  slices: PlanSlice[]
}

interface DishCategory {
  id: number
  name: string
  sort_order: number
}

type PrinterRoleS = 'CASHIER' | 'KITCHEN' | 'BOTH'

function isCatchAll(slice: PlanSlice): boolean {
  return !slice.category_ids || slice.category_ids.length === 0
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

  // 打印方案
  const [plans, setPlans] = useState<PrintPlan[]>([])
  const [categories, setCategories] = useState<DishCategory[]>([])
  const [editingPlan, setEditingPlan] = useState<PrintPlan | 'new' | null>(null)

  const refreshAll = useCallback(async () => {
    setLoading(true)
    try {
      const [pr, tp, pl, cats]: any[] = await Promise.all([
        request.get('/merchant-ops/printers'),
        request.get('/merchant-ops/print-templates'),
        request.get('/merchant-ops/print-plans'),
        request.get('/dishes/categories'),
      ])
      setPrinters((pr?.data ?? pr) as Printer[])
      setTemplates((tp?.data ?? tp) as Template[])
      setPlans((pl?.data ?? pl) as PrintPlan[])
      setCategories((cats?.data ?? cats) as DishCategory[])
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

  const handleDeletePlan = (plan: PrintPlan) => {
    if (plan.is_system_default) { showToast('系统默认方案不可删除', 'warning'); return }
    showConfirm(`确定删除方案「${plan.name}」？`, async () => {
      try {
        await request.delete(`/merchant-ops/print-plans/${plan.id}`)
        showToast('已删除', 'success')
        await refreshAll()
      } catch (err: any) { showToast(err?.message || '删除失败', 'error') }
    })
  }

  const handleDeleteTemplate = async (tpl: Template) => {
    showConfirm(`确定删除模板「${tpl.name}」？引用此模板的打印机会自动回退到默认模板`, async () => {
      try {
        await request.delete(`/merchant-ops/print-templates/${tpl.id}`)
        showToast('已删除', 'success')
        await refreshAll()
      } catch (err: any) {
        const code = err?.code
        if (code === 'TEMPLATE_PROTECTED') showToast('系统默认模板不能删除', 'warning')
        else if (code === 'TEMPLATE_LAST_ONE') showToast('至少保留一个模板', 'warning')
        else showToast(err?.message || '删除失败', 'error')
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
            <p className="text-xs text-[#94A3B8] mt-0.5">飞鹅 / 易联 / 中易 / 芯烨云 + 浏览器打印 · 模板编辑 · 自动打印 · 离线重试</p>
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
          {templates.map((t) => {
            const isSystem = t.id === 1 || t.id === 2
            return (
              <div
                key={t.id}
                className="text-left p-4 rounded-lg border border-[#E2E8F0] bg-white hover:border-[#2563EB] hover:shadow transition-all"
              >
                <button
                  onClick={() => setEditTemplate(t)}
                  className="w-full text-left cursor-pointer"
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
                <div className="mt-3 flex items-center justify-between">
                  {isSystem ? (
                    <span className="text-xs text-[#94A3B8]">系统默认</span>
                  ) : (
                    <span className="text-xs text-[#94A3B8]">自定义</span>
                  )}
                  {!isSystem && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteTemplate(t)
                      }}
                      className="text-xs text-[#DC2626] hover:underline cursor-pointer inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      删除
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 打印方案 */}
      <section className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#0F172A]">打印方案</h2>
          <button
            onClick={() => setEditingPlan('new')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] transition-colors"
          >
            <Plus className="w-4 h-4" />
            新建方案
          </button>
        </div>
        <div className="mb-4 p-3 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] text-xs text-[#1E40AF]">
          方案 = 打印机 + 模板 + 菜品分类的组合。配好打印机和模板后，在这里组合成完整的分单打印方案。系统默认「整单全票」方案兜底。
        </div>
        {plans.length === 0 ? (
          <div className="text-center py-8 text-[#94A3B8] text-sm">暂无方案</div>
        ) : (
          <div className="space-y-3">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                printers={printers}
                templates={templates}
                categories={categories}
                onEdit={() => setEditingPlan(plan)}
                onDelete={() => handleDeletePlan(plan)}
              />
            ))}
          </div>
        )}
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
      {editingPlan && (
        <PlanEditor
          plan={editingPlan === 'new' ? makeEmptyPlan(printers) : { ...editingPlan, slices: editingPlan.slices.map((s) => ({ ...s })) }}
          isNew={editingPlan === 'new'}
          printers={printers.filter(p => p.enabled)}
          templates={templates}
          categories={categories}
          onClose={() => setEditingPlan(null)}
          onSaved={async () => { setEditingPlan(null); await refreshAll() }}
        />
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
  const Icon = CLOUD_PROVIDERS.includes(printer.provider) ? Cloud : printer.provider === 'BROWSER' ? Monitor : Printer
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
    if (CLOUD_PROVIDERS.includes(provider) && !deviceSn.trim()) { showToast(`${PROVIDER_LABEL[provider]}必须填终端号 (SN)`, 'warning'); return }
    if (CLOUD_PROVIDERS.includes(provider) && isNew && !deviceKey.trim()) { showToast(`${PROVIDER_LABEL[provider]}必须填密钥`, 'warning'); return }
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="品牌">
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className={inputCls}>
              <optgroup label="云打印（互联网，无需电脑）">
                <option value="FEIE">飞鹅云</option>
                <option value="YLY">易联云</option>
                <option value="ZYY">中易云 / 365 云打印</option>
                <option value="XPRINTER">芯烨云</option>
              </optgroup>
              <optgroup label="本地打印">
                <option value="BROWSER">浏览器（USB / 共享打印机）</option>
              </optgroup>
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
        {CLOUD_PROVIDERS.includes(provider) && (
          <>
            <Field label="终端号 (SN / 机器号)">
              <input value={deviceSn} onChange={(e) => setDeviceSn(e.target.value)} className={inputCls} placeholder={`${PROVIDER_LABEL[provider]}打印机背面 SN`} />
            </Field>
            <Field label={isNew ? '终端密钥 (KEY)' : '终端密钥（留空保持不变）'}>
              <input
                type="password"
                value={deviceKey}
                onChange={(e) => setDeviceKey(e.target.value)}
                className={inputCls}
                placeholder={isNew ? `${PROVIDER_LABEL[provider]}打印机背面 KEY` : (initial?.has_device_key ? '已设置' : '未设置')}
              />
            </Field>
            <p className="text-xs text-[#94A3B8] -mt-1">
              {provider === 'FEIE' && '需在 server/.env 配置 FEIE_USER 和 FEIE_UKEY。注册：feieyun.com'}
              {provider === 'YLY' && '需在 server/.env 配置 YLY_CLIENT_ID 和 YLY_CLIENT_SECRET。注册：10ss.net'}
              {provider === 'ZYY' && '需在 server/.env 配置 ZYY_MEMBER_CODE 和 ZYY_API_KEY。注册：365cup.com'}
              {provider === 'XPRINTER' && '需在 server/.env 配置 XPRINTER_USER 和 XPRINTER_USER_KEY。注册：open.xpyun.net'}
            </p>
          </>
        )}
        {provider === 'BROWSER' && (
          <p className="text-xs text-[#94A3B8] p-3 bg-[#F8FAFC] rounded-lg">
            <strong>浏览器打印</strong>说明：后端会通过 WebSocket 推送 HTML 小票到本管理页，自动打开打印预览窗，调用电脑连接的打印机（USB 直连或网络共享）。
            <br /><br />
            适用：商家电脑接了 USB 小票打印机，或局域网内有共享打印机。<strong>无需任何 SN/KEY</strong>。
          </p>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
  const [previewScenario, setPreviewScenario] = useState<'dine_in' | 'takeaway'>('dine_in')

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

  const loadPreview = async (id?: number, scenario: 'dine_in' | 'takeaway' = previewScenario) => {
    const tid = id ?? (isNew ? null : (target as Template).id)
    if (!tid) return
    setPreviewLoading(true)
    try {
      const url = `/merchant-ops/print-templates/${tid}/preview${scenario === 'takeaway' ? '?scenario=takeaway' : ''}`
      const res: any = await request.post(url)
      const data = res?.data ?? res
      setPreviewHtml(data?.html ?? '')
    } catch (err: any) {
      showToast(err?.message || '预览失败', 'error')
    } finally {
      setPreviewLoading(false)
    }
  }

  useEffect(() => {
    if (!isNew) loadPreview(undefined, previewScenario)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewScenario])

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
            <label className="block text-xs text-[#64748B] mb-2">
              勾选字段（<span className="text-[#DC2626]">{REQUIRED_FIELDS.join('、')}</span> 必选 ·
              <span className="ml-1 text-[#16A34A]">{RECOMMENDED_FOR_FULL.join('、')}</span> 推荐前台用）
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-2 gap-2">
              {ALL_FIELDS.map((f) => {
                const checked = fields.has(f)
                const required = (REQUIRED_FIELDS as ReadonlyArray<string>).includes(f)
                const recommended = (RECOMMENDED_FOR_FULL as ReadonlyArray<string>).includes(f)
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
                    {required && <span className="text-xs text-[#DC2626]">必选</span>}
                    {!required && recommended && <span className="text-xs text-[#16A34A]">推荐</span>}
                  </label>
                )
              })}
            </div>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#64748B]">实时预览</span>
              <div className="flex bg-[#F1F5F9] rounded p-0.5 text-xs">
                <button
                  onClick={() => setPreviewScenario('dine_in')}
                  disabled={isNew}
                  className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                    previewScenario === 'dine_in' ? 'bg-white shadow-sm text-[#0F172A]' : 'text-[#64748B] hover:text-[#0F172A]'
                  } disabled:opacity-50`}
                >
                  堂食
                </button>
                <button
                  onClick={() => setPreviewScenario('takeaway')}
                  disabled={isNew}
                  className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
                    previewScenario === 'takeaway' ? 'bg-white shadow-sm text-[#0F172A]' : 'text-[#64748B] hover:text-[#0F172A]'
                  } disabled:opacity-50`}
                >
                  外带
                </button>
              </div>
            </div>
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
      <div className="max-h-[60vh] overflow-y-auto overflow-x-auto">
        {loading ? (
          <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin text-[#2563EB] inline" /></div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12 text-[#94A3B8] text-sm">暂无任务</div>
        ) : (
          <table className="w-full text-sm min-w-[640px]">
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

// ============================================================
// 打印方案 PlanCard
// ============================================================
function makeEmptySlice(printers: Printer[]): PlanSlice {
  const first = printers[0]
  return {
    printer_id: first?.id ?? 0,
    template_id: null,
    printer_role_snapshot: (first?.role ?? 'BOTH') as PrinterRoleS,
    category_ids: null,
    label: '',
    sort_order: 0,
  }
}

function makeEmptyPlan(printers: Printer[]): PrintPlan {
  return {
    id: 0,
    name: '',
    enabled: true,
    is_default_dine_in: false,
    is_default_takeaway: false,
    is_system_default: false,
    description: null,
    slices: [makeEmptySlice(printers)],
  }
}

const ROLE_LABEL_S: Record<string, string> = {
  CASHIER: '前台',
  KITCHEN: '后厨',
  BOTH: '前台+后厨',
}

function PlanCard({
  plan, printers, templates, categories, onEdit, onDelete,
}: {
  plan: PrintPlan
  printers: Printer[]
  templates: Template[]
  categories: DishCategory[]
  onEdit: () => void
  onDelete: () => void
}) {
  const printerMap = useMemo(() => new Map(printers.map((p) => [p.id, p])), [printers])
  const templateMap = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates])
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  return (
    <div className="bg-white rounded-lg border border-[#E2E8F0] overflow-hidden hover:border-[#2563EB] hover:shadow transition-all">
      <div className="p-4 flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="text-base font-semibold text-[#0F172A]">{plan.name}</h3>
            {plan.is_system_default && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-[#F1F5F9] text-[#475569]">
                <ShieldCheck className="w-3 h-3" />系统默认
              </span>
            )}
            {!plan.enabled && <span className="px-2 py-0.5 rounded text-xs bg-[#FEE2E2] text-[#991B1B]">已停用</span>}
            {plan.is_default_dine_in && <span className="px-2 py-0.5 rounded text-xs bg-[#DCFCE7] text-[#166534]">堂食默认</span>}
            {plan.is_default_takeaway && <span className="px-2 py-0.5 rounded text-xs bg-[#FFEDD5] text-[#9A3412]">外带默认</span>}
          </div>
          {plan.description && <p className="text-sm text-[#64748B] mb-2">{plan.description}</p>}
          {plan.slices.length === 0 ? (
            <p className="text-xs text-[#94A3B8]">尚未配置切片</p>
          ) : (
            <div className="space-y-1 mt-2">
              {plan.slices.map((slice, idx) => {
                const printer = printerMap.get(slice.printer_id)
                const tpl = slice.template_id ? templateMap.get(slice.template_id) : null
                const cats = slice.category_ids
                return (
                  <div key={idx} className="flex flex-wrap items-center gap-1.5 text-xs bg-slate-50 rounded px-2 py-1.5 border border-[#F1F5F9]">
                    <span className="text-[#64748B] font-mono">#{idx + 1}</span>
                    <span className="text-[#64748B]">→ {printer?.name ?? `(已删)`}</span>
                    {tpl && <span className="text-[#64748B]">· {tpl.name}</span>}
                    {isCatchAll(slice) ? (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-[#FEF3C7] text-[#92400E]">全分类</span>
                    ) : (
                      <span className="text-[#475569]">{cats?.map((id) => categoryMap.get(id)?.name ?? `(已删)`).join('、')}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="flex sm:flex-col gap-2 sm:w-28 sm:flex-shrink-0">
          <button onClick={onEdit} className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-[#E2E8F0] hover:bg-slate-50 text-sm text-[#475569]">
            <Edit className="w-4 h-4" />编辑
          </button>
          {!plan.is_system_default && (
            <button onClick={onDelete} className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-[#FECACA] text-[#B91C1C] hover:bg-red-50 text-sm">
              <Trash2 className="w-4 h-4" />删除
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 打印方案 PlanEditor
// ============================================================
function PlanEditor({
  plan, isNew, printers, templates, categories, onClose, onSaved,
}: {
  plan: PrintPlan
  isNew: boolean
  printers: Printer[]
  templates: Template[]
  categories: DishCategory[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { showToast } = useModal()
  const [name, setName] = useState(plan.name)
  const [enabled, setEnabled] = useState(plan.enabled)
  const [isDefaultDineIn, setIsDefaultDineIn] = useState(plan.is_default_dine_in)
  const [isDefaultTakeaway, setIsDefaultTakeaway] = useState(plan.is_default_takeaway)
  const [description, setDescription] = useState(plan.description ?? '')
  const [slices, setSlices] = useState<PlanSlice[]>(plan.slices.length > 0 ? plan.slices : [makeEmptySlice(printers)])
  const [saving, setSaving] = useState(false)

  const printerMap = useMemo(() => new Map(printers.map((p) => [p.id, p])), [printers])

  const updateSlice = (idx: number, patch: Partial<PlanSlice>) => {
    setSlices((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  const addSlice = () => {
    if (slices.length >= 20) { showToast('单个方案最多 20 个切片', 'warning'); return }
    setSlices((prev) => [...prev, { ...makeEmptySlice(printers), sort_order: prev.length }])
  }

  const removeSlice = (idx: number) => {
    if (slices.length <= 1) { showToast('至少保留 1 个切片', 'warning'); return }
    setSlices((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSave = async () => {
    if (!name.trim()) { showToast('请输入方案名称', 'warning'); return }
    for (const s of slices) {
      if (!s.printer_id || !printerMap.has(s.printer_id)) { showToast('每个切片必须选打印机', 'warning'); return }
    }
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        enabled,
        is_default_dine_in: isDefaultDineIn,
        is_default_takeaway: isDefaultTakeaway,
        description: description.trim() ? description.trim() : null,
        slices: slices.map((s, idx) => ({
          printer_id: s.printer_id,
          template_id: s.template_id,
          printer_role_snapshot: printerMap.get(s.printer_id)?.role ?? s.printer_role_snapshot,
          category_ids: s.category_ids && s.category_ids.length > 0 ? s.category_ids : null,
          label: s.label?.trim() || '',
          sort_order: idx,
        })),
      }
      if (isNew) {
        await request.post('/merchant-ops/print-plans', body)
        showToast('已创建', 'success')
      } else {
        await request.put(`/merchant-ops/print-plans/${plan.id}`, body)
        showToast('已保存', 'success')
      }
      await onSaved()
    } catch (err: any) { showToast(err?.message || '保存失败', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <h2 className="text-lg font-semibold text-[#0F172A]">{isNew ? '新建打印方案' : `编辑：${plan.name}`}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-5 h-5 text-[#64748B]" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-[#475569]">名称 *</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：堂食 · 后厨分单" disabled={plan.is_system_default && !isNew}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E2E8F0] focus:outline-none focus:border-[#2563EB] text-sm disabled:bg-slate-50" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#475569]">备注</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="可选"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E2E8F0] focus:outline-none focus:border-[#2563EB] text-sm" />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#E2E8F0] cursor-pointer">
              <input type="checkbox" checked={enabled} disabled={plan.is_system_default} onChange={(e) => setEnabled(e.target.checked)} className="rounded" />
              <span className="text-sm">启用</span>
            </label>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#E2E8F0] cursor-pointer">
              <input type="checkbox" checked={isDefaultDineIn} onChange={(e) => setIsDefaultDineIn(e.target.checked)} className="rounded" />
              <span className="text-sm">堂食默认</span>
            </label>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#E2E8F0] cursor-pointer">
              <input type="checkbox" checked={isDefaultTakeaway} onChange={(e) => setIsDefaultTakeaway(e.target.checked)} className="rounded" />
              <span className="text-sm">外带默认</span>
            </label>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-[#0F172A]">切片配置（{slices.length}/20）</h3>
              <button onClick={addSlice} disabled={slices.length >= 20}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#2563EB] text-[#2563EB] hover:bg-blue-50 text-xs font-medium disabled:opacity-50">
                <Plus className="w-3 h-3" />添加切片
              </button>
            </div>
            <div className="space-y-3">
              {slices.map((slice, idx) => (
                <SliceEditor key={idx} index={idx} slice={slice} printers={printers} templates={templates} categories={categories}
                  canDelete={slices.length > 1} onChange={(patch) => updateSlice(idx, patch)} onRemove={() => removeSlice(idx)} />
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-[#E2E8F0] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#E2E8F0] text-[#475569] hover:bg-slate-50 text-sm">取消</button>
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-medium disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{isNew ? '创建' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// SliceEditor
// ============================================================
function SliceEditor({
  index, slice, printers, templates, categories, canDelete, onChange, onRemove,
}: {
  index: number
  slice: PlanSlice
  printers: Printer[]
  templates: Template[]
  categories: DishCategory[]
  canDelete: boolean
  onChange: (patch: Partial<PlanSlice>) => void
  onRemove: () => void
}) {
  const catchAll = isCatchAll(slice)

  const toggleCategory = (id: number) => {
    const cur = slice.category_ids ?? []
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    onChange({ category_ids: next.length > 0 ? next : null })
  }

  return (
    <div className="rounded-lg border border-[#E2E8F0] p-3 space-y-3 bg-slate-50/50">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono bg-white border border-[#E2E8F0] text-[#64748B]">切片 #{index + 1}</span>
        {canDelete && <button onClick={onRemove} className="text-[#B91C1C] hover:bg-red-50 p-1 rounded" title="删除切片"><Trash2 className="w-4 h-4" /></button>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-[#475569]">打印机 *</span>
          <select value={slice.printer_id || ''} onChange={(e) => {
            const id = Number(e.target.value)
            const p = printers.find((x) => x.id === id)
            onChange({ printer_id: id, printer_role_snapshot: (p?.role ?? 'BOTH') as PrinterRoleS })
          }} className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E2E8F0] focus:outline-none focus:border-[#2563EB] text-sm bg-white">
            <option value="">请选择</option>
            {printers.map((p) => <option key={p.id} value={p.id}>{p.name}（{ROLE_LABEL_S[p.role]}）</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-[#475569]">模板</span>
          <select value={slice.template_id ?? ''} onChange={(e) => onChange({ template_id: e.target.value ? Number(e.target.value) : null })}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E2E8F0] focus:outline-none focus:border-[#2563EB] text-sm bg-white">
            <option value="">使用打印机默认</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}（{t.width}）</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-[#475569]">切片名（可选）</span>
          <input value={slice.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="例：烧烤档" maxLength={100}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E2E8F0] focus:outline-none focus:border-[#2563EB] text-sm" />
        </label>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-[#475569]">打印分类 {catchAll && <span className="text-[#92400E] font-semibold">（兜底切片）</span>}</span>
          <button onClick={() => onChange({ category_ids: null })} className="text-xs text-[#2563EB] hover:underline">清空（设为兜底）</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.length === 0 ? <span className="text-xs text-[#94A3B8]">尚无分类</span> : categories.map((c) => {
            const checked = (slice.category_ids ?? []).includes(c.id)
            return (
              <button key={c.id} onClick={() => toggleCategory(c.id)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  checked ? 'bg-[#2563EB] text-white border-[#2563EB]' : 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#2563EB]'
                }`}>
                {checked && <Check className="w-3 h-3" />}{c.name}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
