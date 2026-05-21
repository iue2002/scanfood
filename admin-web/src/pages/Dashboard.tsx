import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import request from '@/api/request'
import { useAuthStore } from '@/stores/auth'
import {
  DollarSign, ShoppingCart, TrendingUp, Receipt,
  ArrowUp, ArrowDown, Minus,
  LogIn, LayoutGrid, ClipboardList, RotateCcw,
  AlertTriangle,
} from 'lucide-react'
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { useWebSocketEvent } from '@/components/WebSocketProvider'
import { requestNotificationPermission } from '@/utils/notification'

interface Overview {
  today_amount: string
  today_count: number
  total_orders: number
  total_amount: string
  yesterday_amount: string
  yesterday_count: number
  amount_change_pct: number
  count_change_pct: number
  week_amount: string
  week_count: number
  month_amount: string
  month_count: number
  avg_today: string
  avg_week: string
  status_distribution: Record<string, number>
  pending_refund: number
  approved_refund_amount: string
}

interface DayPoint { date: string; total_amount: number; order_count: number }
interface HourPoint { hour: string; amount: number; count: number }
interface DishRow { dish_id: number; dish_name: string; quantity: number; amount: number }

const STATUS_LABEL: Record<string, string> = {
  submitted: '已提交', printed: '已打印', settled: '已结账', cancelled: '已取消', refunded: '已退款',
}
const STATUS_COLOR: Record<string, string> = {
  submitted: '#F59E0B', printed: '#2563EB', settled: '#10B981', cancelled: '#EF4444', refunded: '#94A3B8',
}

function ChangeBadge({ pct }: { pct: number }) {
  if (pct === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-[#94A3B8]">
        <Minus size={12} /> 持平
      </span>
    )
  }
  const positive = pct > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${positive ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
      {positive ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

export default function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [dayData, setDayData] = useState<DayPoint[]>([])
  const [hourData, setHourData] = useState<HourPoint[]>([])
  const [topDishes, setTopDishes] = useState<DishRow[]>([])
  const [loading, setLoading] = useState(true)
  const lastLogin = useAuthStore((s) => s.lastLogin)
  const navigate = useNavigate()

  const fetchAll = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10)
    const weekStart = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    try {
      const [ov, day, hour, dish] = await Promise.all([
        request.get('/statistics/overview'),
        request.get('/statistics/day', { params: { start_date: weekStart, end_date: today } }),
        request.get('/statistics/hourly-today'),
        request.get('/statistics/dish-ranking', { params: { limit: 5, start_date: today, end_date: today } }),
      ])
      setOverview(ov as any)
      setDayData((day as any) || [])
      setHourData((hour as any) || [])
      setTopDishes((dish as any) || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    requestNotificationPermission()
  }, [fetchAll])

  useWebSocketEvent('orderUpdated', fetchAll)
  useWebSocketEvent('orderStatusChanged', fetchAll)
  useWebSocketEvent('orderDeleted', fetchAll)
  useWebSocketEvent('refundCreated', fetchAll)
  useWebSocketEvent('refundUpdated', fetchAll)

  const kpiCards = [
    {
      label: '今日营业额',
      value: `¥${overview?.today_amount || '0.00'}`,
      pct: overview?.amount_change_pct ?? 0,
      icon: DollarSign,
      color: 'bg-[#2563EB]',
      sub: `昨日 ¥${overview?.yesterday_amount || '0.00'}`,
    },
    {
      label: '今日订单',
      value: overview?.today_count ?? 0,
      pct: overview?.count_change_pct ?? 0,
      icon: ShoppingCart,
      color: 'bg-[#10B981]',
      sub: `昨日 ${overview?.yesterday_count ?? 0} 单`,
    },
    {
      label: '今日客单价',
      value: `¥${overview?.avg_today || '0.00'}`,
      icon: Receipt,
      color: 'bg-[#6366F1]',
      sub: `7 日平均 ¥${overview?.avg_week || '0.00'}`,
    },
    {
      label: '历史总营业额',
      value: `¥${overview?.total_amount || '0.00'}`,
      icon: TrendingUp,
      color: 'bg-[#F59E0B]',
      sub: `共 ${overview?.total_orders ?? 0} 单`,
    },
  ]

  const statusPieData = overview
    ? Object.entries(overview.status_distribution)
        .filter(([_, v]) => v > 0)
        .map(([k, v]) => ({ name: STATUS_LABEL[k] || k, value: v, key: k }))
    : []

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl sm:text-2xl font-semibold text-[#0F172A]">数据总览</h2>
        {overview && overview.pending_refund > 0 && (
          <button
            onClick={() => navigate('/refunds')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FEF3C7] text-[#92400E] rounded-lg text-xs sm:text-sm font-medium hover:bg-[#FDE68A] transition-colors cursor-pointer"
          >
            <AlertTriangle size={14} />
            {overview.pending_refund} 个待审核退款
          </button>
        )}
      </div>

      {lastLogin && (
        <div className="bg-gradient-to-r from-[#EFF6FF] to-[#F0FDF4] rounded-xl p-3 sm:p-4 border border-[#BFDBFE]">
          <div className="flex items-center gap-2 text-xs sm:text-sm text-[#1E40AF]">
            <LogIn size={14} />
            <span className="truncate">
              上次登录 {formatTime(lastLogin.at)} · IP {lastLogin.ip}
            </span>
          </div>
        </div>
      )}

      {/* KPI 卡片 - 响应式 1/2/4 列 */}
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
              <p className="text-lg sm:text-xl lg:text-2xl font-bold text-[#0F172A] mb-1 truncate">
                {loading ? '-' : card.value}
              </p>
              <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs text-[#94A3B8] min-h-[16px]">
                <span className="truncate">{card.sub}</span>
                {card.pct !== undefined && !loading && <ChangeBadge pct={card.pct} />}
              </div>
            </div>
          )
        })}
      </div>

      {/* 中部双栏：左趋势 + 右饼图 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
        {/* 近 7 日趋势 - 占 2/3 */}
        <div className="xl:col-span-2 bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h3 className="text-sm sm:text-base font-semibold text-[#0F172A]">近 7 日营业趋势</h3>
            <span className="text-xs text-[#94A3B8]">共 ¥{overview?.week_amount || '0.00'} · {overview?.week_count ?? 0} 单</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dayData}>
              <defs>
                <linearGradient id="dashAmount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563EB" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#2563EB" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748B' }} tickFormatter={(v) => v?.slice(5)} />
              <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }}
                formatter={(value: any, name: string) => name === '营业额' ? [`¥${value}`, name] : [value, name]}
              />
              <Area type="monotone" dataKey="total_amount" name="营业额" stroke="#2563EB" strokeWidth={2} fill="url(#dashAmount)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* 状态分布饼图 - 占 1/3 */}
        <div className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
          <h3 className="text-sm sm:text-base font-semibold text-[#0F172A] mb-3 sm:mb-4">订单状态分布</h3>
          {statusPieData.length === 0 ? (
            <div className="flex items-center justify-center h-[220px] text-sm text-[#94A3B8]">
              暂无订单
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={statusPieData}
                    cx="50%" cy="50%"
                    innerRadius={40}
                    outerRadius={68}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {statusPieData.map((entry) => (
                      <Cell key={entry.key} fill={STATUS_COLOR[entry.key] || '#94A3B8'} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {statusPieData.map((s) => (
                  <div key={s.key} className="flex items-center gap-1.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: STATUS_COLOR[s.key] || '#94A3B8' }} />
                    <span className="text-[#64748B] truncate">{s.name}</span>
                    <span className="text-[#0F172A] font-medium ml-auto">{s.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 下部双栏：分时 + 热销 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        {/* 24 小时分时 */}
        <div className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h3 className="text-sm sm:text-base font-semibold text-[#0F172A]">今日分时营业额</h3>
            <span className="text-xs text-[#94A3B8]">识别就餐高峰</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#64748B' }} interval={2} />
              <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }}
                formatter={(value: any, name: string) => name === '营业额' ? [`¥${value}`, name] : [value, name]}
              />
              <Bar dataKey="amount" name="营业额" fill="#10B981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 今日 TOP 5 菜品 */}
        <div className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h3 className="text-sm sm:text-base font-semibold text-[#0F172A]">今日热销 TOP 5</h3>
            <button
              onClick={() => navigate('/statistics')}
              className="text-xs text-[#2563EB] hover:underline cursor-pointer"
            >
              查看完整 →
            </button>
          </div>
          {topDishes.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-sm text-[#94A3B8]">
              今日暂无销售
            </div>
          ) : (
            <div className="space-y-2">
              {topDishes.map((d, i) => {
                const max = Math.max(...topDishes.map(t => t.quantity))
                const ratio = max > 0 ? (d.quantity / max) * 100 : 0
                return (
                  <div key={d.dish_id} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${i < 3 ? 'bg-[#2563EB] text-white' : 'bg-gray-100 text-gray-500'}`}>{i + 1}</span>
                        <span className="text-[#0F172A] truncate">{d.dish_name}</span>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <span className="text-[#94A3B8]">{d.quantity} 份</span>
                        <span className="font-semibold text-[#2563EB] tabular-nums">¥{d.amount.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="h-1 bg-[#F1F5F9] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#3B82F6] to-[#2563EB] rounded-full"
                        style={{ width: `${ratio}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 快捷入口 */}
      <div className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
        <h3 className="text-sm sm:text-base font-semibold text-[#0F172A] mb-3 sm:mb-4">快捷操作</h3>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {[
            { label: '桌台看板', icon: LayoutGrid, to: '/' },
            { label: '订单管理', icon: ClipboardList, to: '/orders' },
            { label: '退款售后', icon: RotateCcw, to: '/refunds' },
          ].map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.label}
                onClick={() => navigate(item.to)}
                className="flex flex-col items-center justify-center gap-1.5 sm:gap-2 py-3 sm:py-4 bg-[#F8FAFC] rounded-lg hover:bg-[#EFF6FF] hover:text-[#2563EB] text-[#334155] transition-colors cursor-pointer"
              >
                <Icon size={20} />
                <span className="text-xs sm:text-sm font-medium">{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
