import { useEffect, useRef, useState } from 'react'
import {
  CalendarRange,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Wallet,
  XCircle,
  CheckCircle2,
} from 'lucide-react'
import request from '@/api/request'
import { useModal } from '@/components/ModalProvider'

type OrderStatus = 'submitted' | 'printed' | 'settled' | 'cancelled' | 'refunded'

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: 'submitted', label: '已提交' },
  { value: 'printed', label: '已打印' },
  { value: 'settled', label: '已结账' },
  { value: 'cancelled', label: '已取消' },
  { value: 'refunded', label: '已退款' },
]

interface ExportJob {
  id: string
  type: 'ORDERS' | 'REPORT_DAILY' | 'REPORT_MONTHLY'
  status: 'pending' | 'running' | 'success' | 'failed'
  progress: number
  row_count: number | null
  file_name: string | null
  file_size: number | null
  error_code: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

const fmtDateInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const fmtSize = (bytes: number | null | undefined): string => {
  if (!bytes || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function DataExport() {
  const { showToast } = useModal()
  const today = new Date()
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

  // 订单导出
  const [startAt, setStartAt] = useState(fmtDateInput(sevenDaysAgo))
  const [endAt, setEndAt] = useState(fmtDateInput(today))
  const [statuses, setStatuses] = useState<Set<OrderStatus>>(new Set())
  const [exporting, setExporting] = useState(false)

  // 异步任务跟踪
  const [activeJob, setActiveJob] = useState<ExportJob | null>(null)
  const pollRef = useRef<number | null>(null)

  // 报表导出
  const [reportType, setReportType] = useState<'DAILY' | 'MONTHLY'>('DAILY')
  const [reportDate, setReportDate] = useState(fmtDateInput(today))
  const [generatingReport, setGeneratingReport] = useState(false)

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  const toggleStatus = (s: OrderStatus) => {
    setStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const exportOrdersBlob = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const body = {
        startAt: new Date(startAt + 'T00:00:00').toISOString(),
        endAt: new Date(endAt + 'T23:59:59').toISOString(),
        status: statuses.size > 0 ? Array.from(statuses) : undefined,
      }
      // 使用 raw axios 调用以拿到 blob & header
      const token = localStorage.getItem('admin_token')
      const baseURL = (import.meta as any).env?.VITE_API_BASE_URL || '/api'
      const resp = await fetch(`${baseURL}/merchant-ops/exports/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({} as any))
        const code = j?.code
        if (code === 'RANGE_INVALID') {
          showToast('时间范围非法或超过 92 天', 'warning')
        } else if (code === 'FORBIDDEN') {
          showToast('无权导出，请联系店主', 'error')
        } else {
          showToast(j?.message || j?.msg || '导出失败', 'error')
        }
        return
      }
      const ct = resp.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        // 异步任务
        const j = await resp.json()
        const data = j?.data ?? j
        if (data?.jobId) {
          showToast(`命中 ${data.expectedRowCount} 行，已转为异步导出`, 'info')
          startPollingJob(data.jobId)
        } else {
          showToast('返回格式异常', 'error')
        }
      } else {
        // 同步：直接下载
        const blob = await resp.blob()
        const fileName = parseFileName(resp.headers.get('content-disposition'), 'orders.xlsx')
        downloadBlob(blob, fileName)
        showToast('导出成功', 'success')
      }
    } catch (err: any) {
      showToast(err?.message || '导出失败', 'error')
    } finally {
      setExporting(false)
    }
  }

  const startPollingJob = (jobId: string) => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current)
    }
    setActiveJob({ id: jobId, type: 'ORDERS', status: 'pending', progress: 0, row_count: null, file_name: null, file_size: null, error_code: null, error_message: null, created_at: new Date().toISOString(), completed_at: null })
    const tick = async () => {
      try {
        const res: any = await request.get(`/merchant-ops/exports/${jobId}`)
        const job: ExportJob = res?.data ?? res
        setActiveJob(job)
        if (job.status === 'success' || job.status === 'failed') {
          if (pollRef.current) {
            window.clearInterval(pollRef.current)
            pollRef.current = null
          }
        }
      } catch (err) {
        if (pollRef.current) {
          window.clearInterval(pollRef.current)
          pollRef.current = null
        }
      }
    }
    void tick()
    pollRef.current = window.setInterval(tick, 1500)
  }

  const downloadJob = async (job: ExportJob) => {
    try {
      const token = localStorage.getItem('admin_token')
      const baseURL = (import.meta as any).env?.VITE_API_BASE_URL || '/api'
      const resp = await fetch(`${baseURL}/merchant-ops/exports/${job.id}/download`, {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      })
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({} as any))
        showToast(j?.message || '下载失败', 'error')
        return
      }
      const blob = await resp.blob()
      const fileName = parseFileName(resp.headers.get('content-disposition'), job.file_name || 'orders.xlsx')
      downloadBlob(blob, fileName)
    } catch (err: any) {
      showToast(err?.message || '下载失败', 'error')
    }
  }

  const exportReport = async () => {
    if (generatingReport) return
    setGeneratingReport(true)
    try {
      const body = {
        type: reportType,
        date: reportType === 'MONTHLY' ? reportDate.slice(0, 7) : reportDate,
      }
      const token = localStorage.getItem('admin_token')
      const baseURL = (import.meta as any).env?.VITE_API_BASE_URL || '/api'
      const resp = await fetch(`${baseURL}/merchant-ops/exports/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({} as any))
        showToast(j?.code === 'REPORT_GENERATION_FAILED' ? '报表生成失败' : (j?.message || '导出报表失败'), 'error')
        return
      }
      const blob = await resp.blob()
      const fileName = parseFileName(resp.headers.get('content-disposition'), `report-${reportType.toLowerCase()}-${body.date}.pdf`)
      downloadBlob(blob, fileName)
      showToast('报表已生成', 'success')
    } catch (err: any) {
      showToast(err?.message || '导出报表失败', 'error')
    } finally {
      setGeneratingReport(false)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-[#F8FAFC] min-h-screen">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-[#EFF6FF] flex items-center justify-center">
          <Download className="w-5 h-5 text-[#2563EB]" />
        </div>
        <div>
          <h1 className="text-lg lg:text-xl font-semibold text-[#0F172A]">数据导出</h1>
          <p className="text-xs text-[#94A3B8] mt-0.5">订单 Excel 导出与营业报表 PDF 生成（仅店主可用）</p>
        </div>
      </div>

      {/* 订单 Excel 导出 */}
      <section className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-5 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <FileSpreadsheet className="w-5 h-5 text-[#16A34A]" />
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">订单 Excel 导出</h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">最大 92 天范围 · 命中订单 ≤ 5000 同步下载，超过转为异步任务</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs text-[#64748B] mb-1">开始日期</label>
            <input
              type="date"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-[#64748B] mb-1">结束日期</label>
            <input
              type="date"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-[#64748B] mb-1 flex items-center gap-1">
              <CalendarRange className="w-3.5 h-3.5" />
              状态筛选（默认全部）
            </label>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((opt) => {
                const checked = statuses.has(opt.value)
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggleStatus(opt.value)}
                    className={`px-2.5 py-1 rounded-full text-xs cursor-pointer transition-colors ${
                      checked
                        ? 'bg-[#2563EB] text-white'
                        : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <button
          onClick={exportOrdersBlob}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          导出 Excel
        </button>

        {/* 异步任务状态 */}
        {activeJob && (
          <div className="mt-4 p-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {activeJob.status === 'success' && <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />}
                {activeJob.status === 'failed' && <XCircle className="w-4 h-4 text-[#DC2626]" />}
                {(activeJob.status === 'pending' || activeJob.status === 'running') && (
                  <Loader2 className="w-4 h-4 animate-spin text-[#2563EB]" />
                )}
                <span className="text-sm font-medium text-[#0F172A]">
                  异步导出任务 {activeJob.id.slice(0, 8)}…
                </span>
                <span className="text-xs text-[#64748B]">
                  {activeJob.status === 'pending' && '排队中'}
                  {activeJob.status === 'running' && '生成中'}
                  {activeJob.status === 'success' && '已完成'}
                  {activeJob.status === 'failed' && '失败'}
                </span>
              </div>
              {activeJob.status === 'success' && (
                <button
                  onClick={() => downloadJob(activeJob)}
                  className="text-xs text-[#2563EB] hover:underline cursor-pointer inline-flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  下载 ({fmtSize(activeJob.file_size)})
                </button>
              )}
            </div>
            <div className="w-full h-1.5 bg-[#E2E8F0] rounded">
              <div
                className={`h-full rounded transition-all ${
                  activeJob.status === 'failed' ? 'bg-[#DC2626]' : 'bg-[#2563EB]'
                }`}
                style={{ width: `${activeJob.progress}%` }}
              />
            </div>
            {activeJob.error_message && (
              <p className="text-xs text-[#DC2626] mt-2">{activeJob.error_message}</p>
            )}
          </div>
        )}
      </section>

      {/* 营业报表 PDF */}
      <section className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] p-5">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="w-5 h-5 text-[#9333EA]" />
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">营业报表 PDF</h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">含订单数、营业额、退款额、桌均、品类销量、Top 菜品</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-[#64748B] mb-1">报表类型</label>
            <div className="flex gap-2">
              {(['DAILY', 'MONTHLY'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setReportType(t)}
                  className={`flex-1 px-3 py-2 rounded-lg border-2 text-sm cursor-pointer transition-colors ${
                    reportType === t
                      ? 'border-[#9333EA] bg-[#FAF5FF] text-[#7E22CE]'
                      : 'border-[#E2E8F0] bg-white text-[#475569] hover:border-[#CBD5E1]'
                  }`}
                >
                  {t === 'DAILY' ? '日报' : '月报'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-[#64748B] mb-1">
              {reportType === 'DAILY' ? '日期 (YYYY-MM-DD)' : '月份 (YYYY-MM)'}
            </label>
            <input
              type={reportType === 'DAILY' ? 'date' : 'month'}
              value={reportType === 'DAILY' ? reportDate : reportDate.slice(0, 7)}
              onChange={(e) => setReportDate(reportType === 'DAILY' ? e.target.value : `${e.target.value}-01`)}
              className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:border-[#9333EA] focus:ring-1 focus:ring-[#9333EA] outline-none"
            />
          </div>
        </div>

        <button
          onClick={exportReport}
          disabled={generatingReport}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#9333EA] text-white text-sm font-medium hover:bg-[#7E22CE] disabled:opacity-50 transition-colors"
        >
          {generatingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
          生成报表 PDF
        </button>
      </section>
    </div>
  )
}

function parseFileName(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  const m = /filename\*?=(?:UTF-8'')?["']?([^;"']+)["']?/i.exec(disposition)
  if (!m) return fallback
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}
