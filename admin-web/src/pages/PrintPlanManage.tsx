import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Edit,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import request from '@/api/request'
import { useModal } from '@/components/ModalProvider'

// ============================================================
// 类型
// ============================================================
type PrinterRole = 'CASHIER' | 'KITCHEN' | 'BOTH'

interface Printer {
  id: number
  name: string
  role: PrinterRole
  enabled: boolean
}

interface Template {
  id: number
  name: string
  width: '58mm' | '80mm'
}

interface DishCategory {
  id: number
  name: string
  sort_order: number
}

interface PlanSlice {
  id?: number
  printer_id: number
  template_id: number | null
  printer_role_snapshot: PrinterRole
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

const ROLE_LABEL: Record<PrinterRole, string> = {
  CASHIER: '前台',
  KITCHEN: '后厨',
  BOTH: '前台+后厨',
}

// ============================================================
// 工具
// ============================================================
function isCatchAll(slice: PlanSlice): boolean {
  return !slice.category_ids || slice.category_ids.length === 0
}

function makeEmptySlice(printers: Printer[]): PlanSlice {
  const first = printers[0]
  return {
    printer_id: first?.id ?? 0,
    template_id: null,
    printer_role_snapshot: (first?.role ?? 'BOTH') as PrinterRole,
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

// ============================================================
// 主组件
// ============================================================
export default function PrintPlanManage() {
  const { showToast, showConfirm } = useModal()
  const [plans, setPlans] = useState<PrintPlan[]>([])
  const [printers, setPrinters] = useState<Printer[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [categories, setCategories] = useState<DishCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PrintPlan | 'new' | null>(null)

  const refreshAll = useCallback(async () => {
    setLoading(true)
    try {
      const [pl, pr, tp, cats]: any[] = await Promise.all([
        request.get('/merchant-ops/print-plans'),
        request.get('/merchant-ops/printers'),
        request.get('/merchant-ops/print-templates'),
        request.get('/dishes/categories'),
      ])
      setPlans((pl?.data ?? pl) as PrintPlan[])
      setPrinters(((pr?.data ?? pr) as Printer[]).filter((p) => p.enabled))
      setTemplates((tp?.data ?? tp) as Template[])
      setCategories((cats?.data ?? cats) as DishCategory[])
    } catch (err: any) {
      showToast(err?.message || '加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { refreshAll() }, [refreshAll])

  const handleDelete = (plan: PrintPlan) => {
    if (plan.is_system_default) {
      showToast('系统默认方案不可删除', 'warning')
      return
    }
    showConfirm(`确定删除方案「${plan.name}」？`, async () => {
      try {
        await request.delete(`/merchant-ops/print-plans/${plan.id}`)
        showToast('已删除', 'success')
        await refreshAll()
      } catch (err: any) {
        showToast(err?.message || '删除失败', 'error')
      }
    })
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] flex items-center gap-2">
            <Layers className="w-6 h-6 text-[#2563EB]" />
            打印方案
          </h1>
          <p className="text-sm text-[#64748B] mt-1">
            按订单类型 / 菜品分类自定义打印方式：整单全票、按分类分单、选购打印
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refreshAll}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E2E8F0] hover:bg-slate-50 text-sm text-[#475569]"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
          <button
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            新建方案
          </button>
        </div>
      </div>

      {/* 说明 */}
      <div className="mb-5 p-4 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] text-sm text-[#1E40AF]">
        <p className="font-medium mb-1">打印逻辑</p>
        <ul className="list-disc list-inside space-y-0.5 text-[#1E3A8A]">
          <li>商家在「打印设置」配好打印机和模板，再来这里按"切片"组合方案</li>
          <li>每张「切片」决定一张票：发到哪台打印机 + 用什么模板 + 只打哪些分类</li>
          <li>分类留空 / 选 0 项 = 兜底切片（接收所有未匹配的菜）</li>
          <li>商家改分类名 / 删分类 → 自动联动清理，不会遗漏菜品</li>
          <li>系统默认「整单全票」方案不可删，作为兜底</li>
        </ul>
      </div>

      {/* 方案列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-[#2563EB]" />
        </div>
      ) : plans.length === 0 ? (
        <div className="text-center py-16 text-[#94A3B8]">暂无方案</div>
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              printers={printers}
              templates={templates}
              categories={categories}
              onEdit={() => setEditing(plan)}
              onDelete={() => handleDelete(plan)}
            />
          ))}
        </div>
      )}

      {/* 编辑弹窗 */}
      {editing !== null && (
        <PlanEditor
          plan={editing === 'new' ? makeEmptyPlan(printers) : { ...editing, slices: editing.slices.map((s) => ({ ...s })) }}
          isNew={editing === 'new'}
          printers={printers}
          templates={templates}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await refreshAll()
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// PlanCard
// ============================================================
function PlanCard({
  plan,
  printers,
  templates,
  categories,
  onEdit,
  onDelete,
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
    <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] overflow-hidden">
      <div className="p-5 flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="text-lg font-semibold text-[#0F172A]">{plan.name}</h3>
            {plan.is_system_default && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-[#F1F5F9] text-[#475569]">
                <ShieldCheck className="w-3 h-3" />
                系统默认
              </span>
            )}
            {!plan.enabled && (
              <span className="px-2 py-0.5 rounded text-xs bg-[#FEE2E2] text-[#991B1B]">已停用</span>
            )}
            {plan.is_default_dine_in && (
              <span className="px-2 py-0.5 rounded text-xs bg-[#DCFCE7] text-[#166534]">堂食默认</span>
            )}
            {plan.is_default_takeaway && (
              <span className="px-2 py-0.5 rounded text-xs bg-[#FFEDD5] text-[#9A3412]">外带默认</span>
            )}
          </div>
          {plan.description && (
            <p className="text-sm text-[#64748B] mb-2">{plan.description}</p>
          )}

          {/* 切片预览 */}
          {plan.slices.length === 0 ? (
            <p className="text-xs text-[#64748B] italic">
              {plan.is_system_default ? '系统默认：所有 enabled 打印机各打整单一份' : '尚未配置任何切片'}
            </p>
          ) : (
            <div className="space-y-1.5 mt-2">
              {plan.slices.map((slice, idx) => {
                const printer = printerMap.get(slice.printer_id)
                const tpl = slice.template_id ? templateMap.get(slice.template_id) : null
                const cats = slice.category_ids
                const orphanIds = (cats ?? []).filter((id) => !categoryMap.has(id))
                return (
                  <div key={idx} className="flex flex-wrap items-center gap-1.5 text-sm bg-slate-50 rounded-md px-3 py-2 border border-[#F1F5F9]">
                    <span className="px-1.5 py-0.5 rounded bg-white border border-[#E2E8F0] text-xs text-[#64748B] font-mono">#{idx + 1}</span>
                    {slice.label && (
                      <span className="text-xs text-[#0F172A] font-medium">{slice.label}</span>
                    )}
                    <span className="text-[#64748B]">
                      → <span className="text-[#0F172A]">{printer?.name ?? `(打印机 ${slice.printer_id} 已删)`}</span>
                      {' · '}
                      <span className="text-[#64748B]">{ROLE_LABEL[slice.printer_role_snapshot]}</span>
                      {tpl && <> {' · '} <span className="text-[#64748B]">模板：{tpl.name}</span></>}
                    </span>
                    {isCatchAll(slice) ? (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-[#FEF3C7] text-[#92400E]">兜底·全分类</span>
                    ) : (
                      <span className="text-xs text-[#475569]">
                        分类：{(cats ?? []).map((id) => categoryMap.get(id)?.name ?? `(已删·${id})`).join('、')}
                      </span>
                    )}
                    {orphanIds.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-[#B45309]">
                        <AlertTriangle className="w-3 h-3" />
                        含已删分类
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 操作 */}
        <div className="flex sm:flex-col gap-2 sm:w-32 sm:flex-shrink-0">
          <button
            onClick={onEdit}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#E2E8F0] hover:bg-slate-50 text-sm text-[#475569]"
          >
            <Edit className="w-4 h-4" />
            编辑
          </button>
          {!plan.is_system_default && (
            <button
              onClick={onDelete}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#FECACA] text-[#B91C1C] hover:bg-red-50 text-sm"
            >
              <Trash2 className="w-4 h-4" />
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// PlanEditor
// ============================================================
function PlanEditor({
  plan,
  isNew,
  printers,
  templates,
  categories,
  onClose,
  onSaved,
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
  const [slices, setSlices] = useState<PlanSlice[]>(
    plan.slices.length > 0 ? plan.slices : [makeEmptySlice(printers)],
  )
  const [saving, setSaving] = useState(false)

  const printerMap = useMemo(() => new Map(printers.map((p) => [p.id, p])), [printers])

  const updateSlice = (idx: number, patch: Partial<PlanSlice>) => {
    setSlices((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  const addSlice = () => {
    if (slices.length >= 20) {
      showToast('单个方案最多 20 个切片', 'warning')
      return
    }
    setSlices((prev) => [...prev, { ...makeEmptySlice(printers), sort_order: prev.length }])
  }

  const removeSlice = (idx: number) => {
    if (slices.length <= 1) {
      showToast('至少保留 1 个切片', 'warning')
      return
    }
    setSlices((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSave = async () => {
    if (!name.trim()) {
      showToast('请输入方案名称', 'warning')
      return
    }
    if (slices.length === 0) {
      showToast('至少 1 个切片', 'warning')
      return
    }
    for (const s of slices) {
      if (!s.printer_id || !printerMap.has(s.printer_id)) {
        showToast('每个切片必须选打印机', 'warning')
        return
      }
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
    } catch (err: any) {
      showToast(err?.message || '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <h2 className="text-lg font-semibold text-[#0F172A]">
            {isNew ? '新建打印方案' : `编辑：${plan.name}`}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X className="w-5 h-5 text-[#64748B]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 基础信息 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-[#475569]">名称 *</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：堂食 · 后厨分单"
                disabled={plan.is_system_default && !isNew}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E2E8F0] focus:outline-none focus:border-[#2563EB] text-sm disabled:bg-slate-50"
              />
              {plan.is_system_default && (
                <span className="text-xs text-[#94A3B8]">系统默认方案不可改名</span>
              )}
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#475569]">备注</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="可选"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E2E8F0] focus:outline-none focus:border-[#2563EB] text-sm"
              />
            </label>
          </div>

          {/* 启用 + 默认 */}
          <div className="flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#E2E8F0] cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={enabled}
                disabled={plan.is_system_default}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">启用</span>
            </label>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#E2E8F0] cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={isDefaultDineIn}
                onChange={(e) => setIsDefaultDineIn(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">堂食默认</span>
            </label>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#E2E8F0] cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={isDefaultTakeaway}
                onChange={(e) => setIsDefaultTakeaway(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">外带默认</span>
            </label>
          </div>

          {/* 切片列表 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-[#0F172A]">切片配置（{slices.length}/20）</h3>
              <button
                onClick={addSlice}
                disabled={slices.length >= 20}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#2563EB] text-[#2563EB] hover:bg-blue-50 text-xs font-medium disabled:opacity-50"
              >
                <Plus className="w-3 h-3" />
                添加切片
              </button>
            </div>

            <div className="space-y-3">
              {slices.map((slice, idx) => (
                <SliceEditor
                  key={idx}
                  index={idx}
                  slice={slice}
                  printers={printers}
                  templates={templates}
                  categories={categories}
                  canDelete={slices.length > 1}
                  onChange={(patch) => updateSlice(idx, patch)}
                  onRemove={() => removeSlice(idx)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#E2E8F0] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[#E2E8F0] text-[#475569] hover:bg-slate-50 text-sm"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-medium disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isNew ? '创建' : '保存'}
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
  index,
  slice,
  printers,
  templates,
  categories,
  canDelete,
  onChange,
  onRemove,
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
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono bg-white border border-[#E2E8F0] text-[#64748B]">
          切片 #{index + 1}
        </span>
        {canDelete && (
          <button
            onClick={onRemove}
            className="text-[#B91C1C] hover:bg-red-50 p-1 rounded"
            title="删除切片"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-[#475569]">打印机 *</span>
          <select
            value={slice.printer_id || ''}
            onChange={(e) => {
              const id = Number(e.target.value)
              const p = printers.find((x) => x.id === id)
              onChange({ printer_id: id, printer_role_snapshot: (p?.role ?? 'BOTH') as PrinterRole })
            }}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E2E8F0] focus:outline-none focus:border-[#2563EB] text-sm bg-white"
          >
            <option value="">请选择</option>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{ROLE_LABEL[p.role]}）
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-[#475569]">模板</span>
          <select
            value={slice.template_id ?? ''}
            onChange={(e) => onChange({ template_id: e.target.value ? Number(e.target.value) : null })}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E2E8F0] focus:outline-none focus:border-[#2563EB] text-sm bg-white"
          >
            <option value="">使用打印机默认</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}（{t.width}）
              </option>
            ))}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-[#475569]">切片名（可选，会显示在订单号后）</span>
          <input
            value={slice.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="例如：烧烤档"
            maxLength={100}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E2E8F0] focus:outline-none focus:border-[#2563EB] text-sm"
          />
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-[#475569]">
            打印分类 {catchAll && <span className="text-[#92400E] font-semibold">（兜底切片：接收所有未匹配菜品）</span>}
          </span>
          <button
            onClick={() => onChange({ category_ids: null })}
            className="text-xs text-[#2563EB] hover:underline"
          >
            清空（设为兜底）
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.length === 0 ? (
            <span className="text-xs text-[#94A3B8]">尚无分类</span>
          ) : (
            categories.map((c) => {
              const checked = (slice.category_ids ?? []).includes(c.id)
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCategory(c.id)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    checked
                      ? 'bg-[#2563EB] text-white border-[#2563EB]'
                      : 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#2563EB]'
                  }`}
                >
                  {checked && <Check className="w-3 h-3" />}
                  {c.name}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
