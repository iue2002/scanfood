/**
 * 打印操作弹窗：在订单管理页提供"补打/选购打印"的高定制化入口
 *
 * 三种模式：
 *  1. 默认补打（按订单类型走默认方案）
 *  2. 选指定方案补打（从 print-plans 列表中选）
 *  3. 选购打印（勾选 items + 选打印机）
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Printer, ShoppingBasket, X } from 'lucide-react'
import request from '@/api/request'
import { useModal } from '@/components/ModalProvider'

type PrintMode = 'default' | 'plan' | 'selective'

interface OrderItemMini {
  id: number
  dish_name: string
  spec_name: string | null
  quantity: number
  subtotal: string | number
}

interface OrderMini {
  id: number
  order_number: string
  order_type?: string
  order_items?: OrderItemMini[]
}

interface PlanLite {
  id: number
  name: string
  enabled: boolean
  is_default_dine_in: boolean
  is_default_takeaway: boolean
  is_system_default: boolean
  slices: Array<{ id?: number }>
}

interface PrinterLite {
  id: number
  name: string
  role: 'CASHIER' | 'KITCHEN' | 'BOTH'
  enabled: boolean
}

interface TemplateLite {
  id: number
  name: string
  width: '58mm' | '80mm'
}

export default function PrintActionModal({
  order,
  onClose,
  onPrinted,
}: {
  order: OrderMini
  onClose: () => void
  onPrinted?: () => void
}) {
  const { showToast } = useModal()
  const [mode, setMode] = useState<PrintMode>('default')
  const [plans, setPlans] = useState<PlanLite[]>([])
  const [printers, setPrinters] = useState<PrinterLite[]>([])
  const [templates, setTemplates] = useState<TemplateLite[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [selectedPlanId, setSelectedPlanId] = useState<number | ''>('')
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set())
  const [selectedPrinterId, setSelectedPrinterId] = useState<number | ''>('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('')
  const [label, setLabel] = useState('')

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        const [pl, pr, tp]: any[] = await Promise.all([
          request.get('/merchant-ops/print-plans'),
          request.get('/merchant-ops/printers'),
          request.get('/merchant-ops/print-templates'),
        ])
        if (canceled) return
        const planList = ((pl?.data ?? pl) as PlanLite[]).filter((p) => p.enabled)
        setPlans(planList)
        setPrinters(((pr?.data ?? pr) as PrinterLite[]).filter((p) => p.enabled))
        setTemplates((tp?.data ?? tp) as TemplateLite[])
      } catch (err: any) {
        if (!canceled) showToast(err?.message || '加载打印配置失败', 'error')
      } finally {
        if (!canceled) setLoading(false)
      }
    })()
    return () => { canceled = true }
  }, [showToast])

  const orderType = order.order_type === 'takeaway' ? 'takeaway' : 'dine_in'
  const defaultPlan = plans.find((p) =>
    orderType === 'takeaway' ? p.is_default_takeaway : p.is_default_dine_in,
  ) || plans.find((p) => p.is_system_default)

  const items = order.order_items ?? []

  const toggleItem = (id: number) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      if (mode === 'default') {
        const res: any = await request.post(`/merchant-ops/orders/${order.id}/reprint`)
        const data = res?.data ?? res
        if (data?.enqueued > 0) {
          showToast(`已派发 ${data.enqueued} 台打印机补打（${defaultPlan?.name ?? '系统默认'}）`, 'success')
        } else {
          showToast('没有可用打印机', 'warning')
        }
      } else if (mode === 'plan') {
        if (!selectedPlanId) {
          showToast('请选择打印方案', 'warning')
          return
        }
        const res: any = await request.post(`/merchant-ops/orders/${order.id}/reprint?planId=${selectedPlanId}`)
        const data = res?.data ?? res
        const planName = plans.find((p) => p.id === selectedPlanId)?.name ?? `方案 ${selectedPlanId}`
        if (data?.enqueued > 0) {
          showToast(`已按「${planName}」派发 ${data.enqueued} 张票`, 'success')
        } else {
          showToast('方案未匹配任何打印机', 'warning')
        }
      } else {
        if (selectedItemIds.size === 0) {
          showToast('请至少勾选 1 道菜', 'warning')
          return
        }
        if (!selectedPrinterId) {
          showToast('请选择打印机', 'warning')
          return
        }
        await request.post(`/merchant-ops/orders/${order.id}/selective-print`, {
          printer_id: selectedPrinterId,
          template_id: selectedTemplateId || null,
          selected_item_ids: Array.from(selectedItemIds),
          label: label.trim() || undefined,
        })
        showToast(`已发送选购小票（${selectedItemIds.size} 道菜）`, 'success')
      }
      onPrinted?.()
      onClose()
    } catch (err: any) {
      showToast(err?.message || '打印失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <h2 className="text-lg font-semibold text-[#0F172A] inline-flex items-center gap-2">
            <Printer className="w-5 h-5 text-[#9333EA]" />
            打印订单 · {order.order_number}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X className="w-5 h-5 text-[#64748B]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Mode 切换 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <ModeButton
              active={mode === 'default'}
              icon={<Printer className="w-4 h-4" />}
              title="默认补打"
              subtitle={`走${orderType === 'takeaway' ? '外带' : '堂食'}默认方案`}
              onClick={() => setMode('default')}
            />
            <ModeButton
              active={mode === 'plan'}
              icon={<Printer className="w-4 h-4" />}
              title="按方案补打"
              subtitle="自选打印方案"
              onClick={() => setMode('plan')}
            />
            <ModeButton
              active={mode === 'selective'}
              icon={<ShoppingBasket className="w-4 h-4" />}
              title="选购打印"
              subtitle="勾选菜品"
              onClick={() => setMode('selective')}
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-[#2563EB]" />
            </div>
          ) : mode === 'default' ? (
            <div className="rounded-lg border border-[#E2E8F0] p-4 bg-slate-50/50">
              <p className="text-sm text-[#0F172A] mb-1">
                将按{orderType === 'takeaway' ? '外带' : '堂食'}默认方案补打：
              </p>
              <p className="font-semibold text-[#2563EB]">
                {defaultPlan?.name ?? '系统默认 · 整单全票'}
              </p>
              <p className="text-xs text-[#64748B] mt-2">
                {defaultPlan && !defaultPlan.is_system_default
                  ? `按方案中的 ${defaultPlan.slices?.length ?? 0} 个切片拆单打印`
                  : '所有 enabled 打印机各打整单一份'}
              </p>
            </div>
          ) : mode === 'plan' ? (
            <div>
              <label className="block">
                <span className="text-sm font-medium text-[#475569]">选择方案</span>
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value ? Number(e.target.value) : '')}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E2E8F0] focus:outline-none focus:border-[#2563EB] text-sm bg-white"
                >
                  <option value="">请选择方案</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.is_system_default ? '（系统默认）' : ''}
                      {p.is_default_dine_in ? '（堂食默认）' : ''}
                      {p.is_default_takeaway ? '（外带默认）' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-[#475569] mb-2">勾选要打印的菜品</p>
                <div className="rounded-lg border border-[#E2E8F0] divide-y divide-[#F1F5F9] max-h-64 overflow-y-auto">
                  {items.length === 0 ? (
                    <p className="px-3 py-4 text-center text-sm text-[#94A3B8]">无菜品</p>
                  ) : (
                    items.map((it) => {
                      const checked = selectedItemIds.has(it.id)
                      return (
                        <label
                          key={it.id}
                          className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 ${checked ? 'bg-blue-50/50' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleItem(it.id)}
                            className="rounded"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[#0F172A] truncate">
                              {it.dish_name}
                              {it.spec_name && <span className="text-[#64748B]"> ({it.spec_name})</span>}
                              <span className="text-[#64748B] ml-1">x{it.quantity}</span>
                            </p>
                          </div>
                          <span className="text-sm text-[#475569] font-mono">¥{Number(it.subtotal ?? 0).toFixed(2)}</span>
                        </label>
                      )
                    })
                  )}
                </div>
                <div className="flex justify-between text-xs mt-1.5 px-1">
                  <button
                    type="button"
                    onClick={() => setSelectedItemIds(new Set(items.map((i) => i.id)))}
                    className="text-[#2563EB] hover:underline"
                  >
                    全选
                  </button>
                  <span className="text-[#64748B]">已选 {selectedItemIds.size} / {items.length}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-medium text-[#475569]">打印机 *</span>
                  <select
                    value={selectedPrinterId}
                    onChange={(e) => setSelectedPrinterId(e.target.value ? Number(e.target.value) : '')}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E2E8F0] focus:outline-none focus:border-[#2563EB] text-sm bg-white"
                  >
                    <option value="">请选择</option>
                    {printers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}（{p.role === 'CASHIER' ? '前台' : p.role === 'KITCHEN' ? '后厨' : '前台+后厨'}）
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#475569]">模板</span>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value ? Number(e.target.value) : '')}
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
                  <span className="text-sm font-medium text-[#475569]">小票备注（可选）</span>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="例如：单点出菜 / 加单"
                    maxLength={100}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E2E8F0] focus:outline-none focus:border-[#2563EB] text-sm"
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[#E2E8F0] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[#E2E8F0] text-[#475569] hover:bg-slate-50 text-sm"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#9333EA] hover:bg-[#7E22CE] text-white text-sm font-medium disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            打印
          </button>
        </div>
      </div>
    </div>
  )
}

function ModeButton({
  active,
  icon,
  title,
  subtitle,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-lg border-2 text-left transition-colors ${
        active
          ? 'border-[#9333EA] bg-purple-50 text-[#581C87]'
          : 'border-[#E2E8F0] bg-white hover:border-[#CBD5E1] text-[#475569]'
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="font-semibold text-sm">{title}</span>
        {active && <Check className="w-3 h-3 text-[#9333EA] ml-auto" />}
      </div>
      <p className="text-xs text-[#64748B]">{subtitle}</p>
    </button>
  )
}
