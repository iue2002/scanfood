import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import request from '@/api/request'
import { useModal } from '@/components/ModalProvider'
import { ROLE_LABEL } from '@/rbac/types'
import type { AuditAction, Role } from '@/rbac/types'

interface AuditRow {
  id: number
  actor_user_id: number | null
  actor_role: Role
  action: AuditAction
  target_type: string
  target_id: string | null
  payload_json: string
  ip_address: string
  user_agent: string
  created_at: string
}

interface PageResp {
  data: AuditRow[]
  total: number
  page: number
  pageSize: number
}

// AuditAction 中文标签
const ACTION_LABEL: Record<AuditAction, string> = {
  EMPLOYEE_CREATE: '新增员工',
  EMPLOYEE_UPDATE: '修改员工',
  EMPLOYEE_DELETE: '删除员工',
  EMPLOYEE_UPDATE_ROLE: '修改员工角色',
  PASSWORD_RESET: '重置密码',
  PASSWORD_CHANGE: '修改密码',
  ORDER_CHECKOUT: '订单结账',
  ORDER_ADD_ITEM: '加菜',
  ORDER_REFUND: '订单退款',
  MENU_ITEM_UPDATE: '修改菜品',
  PRINTER_CONFIG_UPDATE: '修改打印机配置',
  PRINTER_AUTO_PRINT_TOGGLE: '切换自动打印',
  PRINTER_TEST: '打印机测试',
  PRINT_TEMPLATE_UPDATE: '修改打印模板',
  EXPORT_ORDERS: '导出订单',
  EXPORT_REPORT: '导出报表',
  NOTIF_PREF_UPDATE: '修改通知偏好',
}

const ALL_ACTIONS = Object.keys(ACTION_LABEL) as AuditAction[]

const ROLE_BADGE: Record<Role, string> = {
  owner: 'bg-[#FEF3C7] text-[#92400E]',
  manager: 'bg-[#EFF6FF] text-[#1E40AF]',
  cashier: 'bg-[#D1FAE5] text-[#065F46]',
  waiter: 'bg-[#F1F5F9] text-[#334155]',
  admin: 'bg-purple-100 text-purple-700',
  customer: 'bg-gray-100 text-gray-600',
}

function fmtDateTime(s: string): string {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function fmtDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function AuditLogs() {
  const { showToast } = useModal()

  // 默认查询窗口：最近 7 天
  const today = useMemo(() => new Date(), [])
  const sevenDaysAgo = useMemo(() => new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000), [today])

  const [startAt, setStartAt] = useState<string>(fmtDateInput(sevenDaysAgo))
  const [endAt, setEndAt] = useState<string>(fmtDateInput(today))
  const [filterAction, setFilterAction] = useState<AuditAction | ''>('')
  const [filterTargetType, setFilterTargetType] = useState<string>('')
  const [filterActorId, setFilterActorId] = useState<string>('')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<20 | 50 | 100>(20)
  const [list, setList] = useState<PageResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailRow, setDetailRow] = useState<AuditRow | null>(null)

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, any> = { page, pageSize }
      if (filterAction) params.action = filterAction
      if (filterTargetType.trim()) params.target_type = filterTargetType.trim()
      if (filterActorId.trim()) {
        const n = Number(filterActorId)
        if (!Number.isFinite(n) || n < 1) {
          showToast('操作人 ID 必须是正整数', 'warning')
          setLoading(false)
          return
        }
        params.actor_user_id = n
      }
      if (startAt) params.start_at = new Date(startAt + 'T00:00:00').toISOString()
      if (endAt) {
        // end_at 含当天 23:59:59
        params.end_at = new Date(endAt + 'T23:59:59').toISOString()
      }
      const res = await request.get<PageResp>('/merchant-ops/audit-logs', { params })
      setList(res as unknown as PageResp)
    } catch (err: any) {
      const code = err?.code || err?.error?.code
      if (code === 'RANGE_TOO_LARGE') {
        showToast('查询区间不能超过 90 天', 'warning')
      } else if (code === 'RANGE_INVALID') {
        showToast('开始时间必须早于结束时间', 'warning')
      } else {
        showToast(err?.message || '加载审计日志失败', 'error')
      }
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filterAction, filterTargetType, filterActorId, startAt, endAt, showToast])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const totalPages = useMemo(() => (list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1), [list])

  const handleResetFilters = () => {
    setStartAt(fmtDateInput(sevenDaysAgo))
    setEndAt(fmtDateInput(today))
    setFilterAction('')
    setFilterTargetType('')
    setFilterActorId('')
    setPage(1)
  }

  return (
    <div className="p-4 lg:p-6 bg-[#F8FAFC] min-h-screen">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#EFF6FF] flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-[#2563EB]" />
          </div>
          <div>
            <h1 className="text-lg lg:text-xl font-semibold text-[#0F172A]">审计日志</h1>
            <p className="text-xs text-[#94A3B8] mt-0.5">追溯所有关键操作。仅店主与店长可见。</p>
          </div>
        </div>
        <button
          onClick={fetchList}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-[#E2E8F0] text-sm text-[#334155] hover:bg-[#F1F5F9] disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          刷新
        </button>
      </div>

      {/* 筛选区 */}
      <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-[#64748B] mb-1">开始日期</label>
            <input
              type="date"
              value={startAt}
              onChange={(e) => { setPage(1); setStartAt(e.target.value) }}
              className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-[#64748B] mb-1">结束日期</label>
            <input
              type="date"
              value={endAt}
              onChange={(e) => { setPage(1); setEndAt(e.target.value) }}
              className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-[#64748B] mb-1">动作</label>
            <select
              value={filterAction}
              onChange={(e) => { setPage(1); setFilterAction(e.target.value as AuditAction | '') }}
              className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none"
            >
              <option value="">全部动作</option>
              {ALL_ACTIONS.map((a) => (
                <option key={a} value={a}>{ACTION_LABEL[a]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[#64748B] mb-1">资源类型</label>
            <input
              type="text"
              placeholder="如 employee / order"
              value={filterTargetType}
              onChange={(e) => { setPage(1); setFilterTargetType(e.target.value) }}
              className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-[#64748B] mb-1">操作人 ID</label>
            <input
              type="number"
              min={1}
              placeholder="留空查询全部"
              value={filterActorId}
              onChange={(e) => { setPage(1); setFilterActorId(e.target.value) }}
              className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-[#94A3B8] flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" />
            查询区间最大 90 天 · 90 天前的旧记录请联系运维查询归档
          </p>
          <button
            onClick={handleResetFilters}
            className="text-xs text-[#64748B] hover:text-[#0F172A] cursor-pointer"
          >
            重置筛选
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F8FAFC] text-[#475569] border-b border-[#E2E8F0]">
              <tr>
                <th className="text-left font-medium px-4 py-3 whitespace-nowrap">时间</th>
                <th className="text-left font-medium px-4 py-3 whitespace-nowrap">操作人</th>
                <th className="text-left font-medium px-4 py-3 whitespace-nowrap">动作</th>
                <th className="text-left font-medium px-4 py-3 whitespace-nowrap">资源</th>
                <th className="text-left font-medium px-4 py-3 whitespace-nowrap">IP</th>
                <th className="text-right font-medium px-4 py-3 whitespace-nowrap">详情</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[#94A3B8]">
                    <Loader2 className="w-6 h-6 animate-spin inline-block mr-2" />
                    加载中…
                  </td>
                </tr>
              )}
              {!loading && (!list || list.data.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-[#94A3B8]">
                    <Search className="w-8 h-8 inline-block mb-2" />
                    <p className="text-sm">没有符合条件的审计记录</p>
                  </td>
                </tr>
              )}
              {!loading && list && list.data.map((row) => (
                <tr key={row.id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-4 py-3 text-[#0F172A] whitespace-nowrap">{fmtDateTime(row.created_at)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="text-[#0F172A]">{row.actor_user_id ?? '-'}</span>
                      <span className={`px-2 py-0.5 rounded text-xs ${ROLE_BADGE[row.actor_role] || 'bg-gray-100 text-gray-600'}`}>
                        {ROLE_LABEL[row.actor_role] || row.actor_role}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#334155] whitespace-nowrap">
                    <span className="font-medium">{ACTION_LABEL[row.action] || row.action}</span>
                  </td>
                  <td className="px-4 py-3 text-[#64748B] whitespace-nowrap">
                    <span className="font-mono text-xs">{row.target_type}</span>
                    {row.target_id ? <span className="text-[#94A3B8]"> #{row.target_id}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-[#64748B] whitespace-nowrap font-mono text-xs">{row.ip_address}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setDetailRow(row)}
                      className="text-[#2563EB] text-xs hover:underline cursor-pointer"
                    >
                      查看
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {!loading && list && list.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#E2E8F0] bg-[#F8FAFC]">
            <div className="text-xs text-[#64748B]">
              共 <span className="text-[#0F172A] font-medium">{list.total}</span> 条 · 第 {list.page}/{totalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => { setPage(1); setPageSize(Number(e.target.value) as 20 | 50 | 100) }}
                className="px-2 py-1 rounded border border-[#E2E8F0] text-xs bg-white"
              >
                <option value={20}>20 / 页</option>
                <option value={50}>50 / 页</option>
                <option value={100}>100 / 页</option>
              </select>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded border border-[#E2E8F0] bg-white disabled:opacity-40 hover:bg-[#F1F5F9] cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded border border-[#E2E8F0] bg-white disabled:opacity-40 hover:bg-[#F1F5F9] cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 详情弹窗 */}
      {detailRow && (
        <DetailDialog row={detailRow} onClose={() => setDetailRow(null)} />
      )}
    </div>
  )
}

function DetailDialog({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const parsedPayload = useMemo(() => {
    try {
      return JSON.parse(row.payload_json)
    } catch {
      return { _raw: row.payload_json, _parseError: true }
    }
  }, [row.payload_json])

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <h2 className="text-base font-semibold text-[#0F172A]">审计详情 #{row.id}</h2>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A] cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3 text-sm">
          <Field label="时间" value={fmtDateTime(row.created_at)} />
          <Field label="动作" value={ACTION_LABEL[row.action] || row.action} />
          <Field label="操作人" value={`${row.actor_user_id ?? '-'} (${ROLE_LABEL[row.actor_role] || row.actor_role})`} />
          <Field
            label="资源"
            value={row.target_id ? `${row.target_type} #${row.target_id}` : row.target_type}
          />
          <Field label="IP" value={row.ip_address} />
          <Field label="UA" value={row.user_agent} mono small />
          <div>
            <p className="text-xs text-[#64748B] mb-1.5">Payload (敏感字段已自动脱敏)</p>
            <pre className="bg-[#0F172A] text-[#E2E8F0] rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-80 whitespace-pre-wrap break-all">
              {JSON.stringify(parsedPayload, null, 2)}
            </pre>
          </div>
        </div>
        <div className="flex items-center justify-end px-5 py-3 border-t border-[#E2E8F0] bg-[#F8FAFC]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] cursor-pointer"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-[#64748B] w-16 shrink-0 mt-0.5">{label}</span>
      <span className={`flex-1 ${mono ? 'font-mono' : ''} ${small ? 'text-xs break-all' : 'text-sm'} text-[#0F172A]`}>
        {value || '-'}
      </span>
    </div>
  )
}
