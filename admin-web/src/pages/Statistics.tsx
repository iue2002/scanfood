import { useEffect, useState, useCallback, useMemo } from 'react'
import request from '@/api/request'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  Printer, Calendar, ArrowUp, ArrowDown, Minus,
  DollarSign, ShoppingCart, Receipt, RotateCcw,
} from 'lucide-react'
import { useModal } from '@/components/ModalProvider'

interface Kpi {
  amount: number
  count: number
  avg: number
  refund_amount: number
  amount_pct: number
  count_pct: number
  avg_pct: number
}
interface DayPoint { date: string; total_amount: number; order_count: number }
interface MonthPoint { month: string; total_amount: number; order_count: number }
interface CategoryRow { category_id: number; category_name: string; quantity: number; amount: number }
interface DishRow { dish_id: number; dish_name: string; quantity: number; amount: number }
interface TableRow { table_id: number; order_count: number; total_amount: number }

type RangeKey = 'today' | 'week' | 'month' | 'year' | 'custom'

const PIE_COLORS = ['#2563EB', '#10B981', '#F59E0B', '#6366F1', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6']

function pad(n: number) { return String(n).padStart(2, '0') }
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function offsetStr(days: number) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function ChangeBadge({ pct }: { pct: number }) {
  if (pct === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-[#94A3B8]"><Minus size={12} /> 持平</span>
  const positive = pct > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${positive ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
      {positive ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

const PRESETS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '近 7 日' },
  { key: 'month', label: '近 30 日' },
  { key: 'year', label: '近 12 月' },
  { key: 'custom', label: '自定义' },
]

export default function Statistics() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('month')
  const [startDate, setStartDate] = useState(offsetStr(29))
  const [endDate, setEndDate] = useState(todayStr())

  const [kpi, setKpi] = useState<Kpi | null>(null)
  const [dayData, setDayData] = useState<DayPoint[]>([])
  const [monthData, setMonthData] = useState<MonthPoint[]>([])
  const [categoryData, setCategoryData] = useState<CategoryRow[]>([])
  const [ranking, setRanking] = useState<DishRow[]>([])
  const [hourData, setHourData] = useState<{ hour: string; amount: number; count: number }[]>([])
  const [tableRanking, setTableRanking] = useState<TableRow[]>([])
  const { showToast } = useModal()

  const applyPreset = useCallback((k: RangeKey) => {
    setRangeKey(k)
    if (k === 'today') { setStartDate(todayStr()); setEndDate(todayStr()) }
    else if (k === 'week') { setStartDate(offsetStr(6)); setEndDate(todayStr()) }
    else if (k === 'month') { setStartDate(offsetStr(29)); setEndDate(todayStr()) }
    else if (k === 'year') { setStartDate(offsetStr(365)); setEndDate(todayStr()) }
  }, [])

  const showMonthly = rangeKey === 'year'

  const fetchAll = useCallback(async (s: string, e: string) => {
    const params = { start_date: s, end_date: e }
    try {
      const tasks: Promise<any>[] = [
        request.get('/statistics/kpi', { params }),
        request.get('/statistics/day', { params }),
        request.get('/statistics/category', { params }),
        request.get('/statistics/dish-ranking', { params: { ...params, limit: 10 } }),
        request.get('/statistics/table-ranking', { params: { ...params, limit: 8 } }),
      ]
      if (s === e && s === todayStr()) {
        tasks.push(request.get('/statistics/hourly-today'))
      } else {
        tasks.push(Promise.resolve([]))
      }
      if (rangeKey === 'year') {
        tasks.push(request.get('/statistics/month', { params }))
      } else {
        tasks.push(Promise.resolve([]))
      }
      const [k, day, cat, dish, table, hour, month] = await Promise.all(tasks)
      setKpi(k as any)
      setDayData((day as any) || [])
      setCategoryData((cat as any) || [])
      setRanking((dish as any) || [])
      setTableRanking((table as any) || [])
      setHourData((hour as any) || [])
      setMonthData((month as any) || [])
    } catch (err) {
      console.error('加载统计失败', err)
    }
  }, [rangeKey])

  useEffect(() => {
    fetchAll(startDate, endDate)
  }, [fetchAll, startDate, endDate])

  const handlePrintReport = (type: 'day' | 'month') => {
    const data = type === 'day' ? dayData : (showMonthly ? monthData : dayData)
    const title = type === 'day' ? '日报' : '月报'
    const totalAmount = data.reduce((sum: number, d: any) => sum + (d.total_amount || 0), 0)
    const totalCount = data.reduce((sum: number, d: any) => sum + (d.order_count || 0), 0)
    const lines = [
      `${title}统计`,
      `营业额: ¥${totalAmount.toFixed(2)}`,
      `订单数: ${totalCount}`,
      `统计区间: ${startDate} 至 ${endDate}`,
    ]
    request.post('/merchant-ops/print-reports', { title, lines }).then((res: any) => {
      const enqueued = res?.data?.enqueued ?? res?.enqueued ?? 0
      if (enqueued > 0) {
        showToast(`已派发 ${enqueued} 台打印机`, 'success')
      } else {
        showToast('没有可用打印机，请先在打印设置中配置', 'warning')
      }
    }).catch((err: any) => {
      showToast(err?.message || '打印失败', 'error')
    })
  }

  const totalCategoryQty = useMemo(() => categoryData.reduce((s, c) => s + c.quantity, 0), [categoryData])
  const maxRankingQty = useMemo(() => Math.max(0, ...ranking.map(r => r.quantity)), [ranking])
  const maxTableAmount = useMemo(() => Math.max(0, ...tableRanking.map(t => t.total_amount)), [tableRanking])

  const kpiCards = [
    { label: '区间营业额', value: `¥${(kpi?.amount ?? 0).toFixed(2)}`, pct: kpi?.amount_pct ?? 0, icon: DollarSign, color: 'bg-[#2563EB]' },
    { label: '订单数', value: kpi?.count ?? 0, pct: kpi?.count_pct ?? 0, icon: ShoppingCart, color: 'bg-[#10B981]' },
    { label: '客单价', value: `¥${(kpi?.avg ?? 0).toFixed(2)}`, pct: kpi?.avg_pct ?? 0, icon: Receipt, color: 'bg-[#6366F1]' },
    { label: '退款金额', value: `¥${(kpi?.refund_amount ?? 0).toFixed(2)}`, icon: RotateCcw, color: 'bg-[#F59E0B]' },
  ]

  return (
    <div className="space-y-4 sm:space-y-6">
      <h2 className="text-xl sm:text-2xl font-semibold text-[#0F172A]">数据统计</h2>

      {/* 时间筛选 + 打印 */}
      <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100 space-y-3">
        <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                rangeKey === p.key
                  ? 'bg-[#2563EB] text-white'
                  : 'bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]'
              }`}
            >{p.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 text-[#94A3B8]">
            <Calendar size={14} />
          </div>
          <input
            type="date" value={startDate}
            onChange={e => { setStartDate(e.target.value); setRangeKey('custom') }}
            className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />
          <span className="text-xs sm:text-sm text-[#94A3B8]">至</span>
          <input
            type="date" value={endDate}
            onChange={e => { setEndDate(e.target.value); setRangeKey('custom') }}
            className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => handlePrintReport('day')}
              className="flex items-center gap-1 px-3 py-1.5 bg-[#10B981] text-white rounded-lg text-xs sm:text-sm hover:bg-[#059669] transition-colors cursor-pointer"
            >
              <Printer size={12} /> 打印日报
            </button>
            {showMonthly && (
              <button
                onClick={() => handlePrintReport('month')}
                className="flex items-center gap-1 px-3 py-1.5 bg-[#F59E0B] text-white rounded-lg text-xs sm:text-sm hover:bg-[#D97706] transition-colors cursor-pointer"
              >
                <Printer size={12} /> 打印月报
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 核心 KPI 卡片 - 含环比 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {kpiCards.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="bg-white rounded-xl p-3 sm:p-4 lg:p-5 shadow-sm border border-gray-100 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-2 sm:mb-3">
                <p className="text-xs sm:text-sm text-[#94A3B8] truncate">{card.label}</p>
                <div className={`w-8 h-8 sm:w-10 sm:h-10 ${card.color} rounded-lg flex items-center justify-center shrink-0`}>
                  <Icon size={16} className="text-white sm:hidden" />
                  <Icon size={18} className="text-white hidden sm:block" />
                </div>
              </div>
              <p className="text-lg sm:text-xl lg:text-2xl font-bold text-[#0F172A] mb-1 truncate">{card.value}</p>
              <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs min-h-[16px]">
                <span className="text-[#94A3B8]">较上个周期</span>
                {card.pct !== undefined && <ChangeBadge pct={card.pct} />}
              </div>
            </div>
          )
        })}
      </div>

      {/* 营业额趋势（双轴：金额 + 订单数） */}
      <div className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <h3 className="text-sm sm:text-base font-semibold text-[#0F172A]">
            {showMonthly ? '月营业额趋势' : '日营业额趋势'}
          </h3>
          <span className="text-xs text-[#94A3B8] hidden sm:inline">营业额 与 订单数 双轴</span>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={showMonthly ? monthData : dayData}>
            <defs>
              <linearGradient id="statAmount" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563EB" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#2563EB" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
            <XAxis
              dataKey={showMonthly ? 'month' : 'date'}
              tick={{ fontSize: 11, fill: '#64748B' }}
              tickFormatter={(v) => showMonthly ? v : (v as string)?.slice(5)}
            />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748B' }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748B' }} />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }}
              formatter={(value: any, name: string) => name === '营业额' ? [`¥${value}`, name] : [value, name]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area yAxisId="left" type="monotone" dataKey="total_amount" name="营业额" stroke="#2563EB" strokeWidth={2} fill="url(#statAmount)" />
            <Area yAxisId="right" type="monotone" dataKey="order_count" name="订单数" stroke="#10B981" strokeWidth={2} fill="transparent" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 分类占比 + 时段分析（仅今日） */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        <div className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
          <h3 className="text-sm sm:text-base font-semibold text-[#0F172A] mb-3 sm:mb-4">分类销售占比</h3>
          {categoryData.length === 0 ? (
            <div className="flex items-center justify-center h-[240px] text-sm text-[#94A3B8]">暂无销售数据</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%" cy="50%"
                    innerRadius={42}
                    outerRadius={78}
                    paddingAngle={2}
                    dataKey="amount"
                    nameKey="category_name"
                  >
                    {categoryData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }} formatter={(v: any) => `¥${(v as number).toFixed(2)}`} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {categoryData.map((c, i) => {
                  const pct = totalCategoryQty > 0 ? (c.quantity / totalCategoryQty) * 100 : 0
                  return (
                    <div key={c.category_id} className="flex items-center justify-between gap-2 text-xs sm:text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-[#0F172A] truncate">{c.category_name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[#94A3B8] tabular-nums">{pct.toFixed(1)}%</span>
                        <span className="font-semibold text-[#2563EB] tabular-nums">¥{c.amount.toFixed(2)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* 仅今日显示分时；其它区间显示桌台排行 */}
        {hourData.length > 0 ? (
          <div className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h3 className="text-sm sm:text-base font-semibold text-[#0F172A]">今日分时营业额</h3>
              <span className="text-xs text-[#94A3B8]">识别就餐高峰</span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hourData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#64748B' }} interval={2} />
                <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }}
                  formatter={(v: any, n: string) => n === '营业额' ? [`¥${v}`, n] : [v, n]}
                />
                <Bar dataKey="amount" name="营业额" fill="#10B981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
            <h3 className="text-sm sm:text-base font-semibold text-[#0F172A] mb-3 sm:mb-4">桌台 TOP</h3>
            {tableRanking.length === 0 ? (
              <div className="flex items-center justify-center h-[200px] text-sm text-[#94A3B8]">暂无数据</div>
            ) : (
              <div className="space-y-2">
                {tableRanking.map((t, i) => {
                  const ratio = maxTableAmount > 0 ? (t.total_amount / maxTableAmount) * 100 : 0
                  return (
                    <div key={t.table_id} className="space-y-1">
                      <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${i < 3 ? 'bg-[#F59E0B] text-white' : 'bg-gray-100 text-gray-500'}`}>{i + 1}</span>
                          <span className="text-[#0F172A]">{t.table_id}号桌</span>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <span className="text-[#94A3B8]">{t.order_count} 单</span>
                          <span className="font-semibold text-[#2563EB] tabular-nums">¥{t.total_amount.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="h-1 bg-[#F1F5F9] rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-[#FBBF24] to-[#F59E0B] rounded-full" style={{ width: `${ratio}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 菜品 TOP 10 */}
      <div className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
        <h3 className="text-sm sm:text-base font-semibold text-[#0F172A] mb-3 sm:mb-4">菜品销售 TOP 10</h3>
        {ranking.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-sm text-[#94A3B8]">暂无销售数据</div>
        ) : (
          <div className="space-y-2.5">
            {ranking.map((d, i) => {
              const ratio = maxRankingQty > 0 ? (d.quantity / maxRankingQty) * 100 : 0
              return (
                <div key={d.dish_id} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold shrink-0 ${i < 3 ? 'bg-[#2563EB] text-white' : 'bg-gray-100 text-gray-500'}`}>{i + 1}</span>
                      <span className="text-[#0F172A] truncate">{d.dish_name}</span>
                    </div>
                    <div className="shrink-0 flex items-center gap-2 sm:gap-3">
                      <span className="text-[#94A3B8] tabular-nums">{d.quantity} 份</span>
                      <span className="font-semibold text-[#2563EB] tabular-nums">¥{d.amount.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-[#F1F5F9] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#3B82F6] to-[#2563EB] rounded-full" style={{ width: `${ratio}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
