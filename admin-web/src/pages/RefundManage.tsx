import { useEffect, useState } from 'react'
import request from '@/api/request'
import { CheckCircle, XCircle } from 'lucide-react'
import { useModal } from '@/components/ModalProvider'
import { useWebSocketEvent } from '@/components/WebSocketProvider'
import { useUnread } from '@/components/UnreadProvider'
import { requestNotificationPermission } from '@/utils/notification'

interface Refund {
  id: number
  order_id: number
  amount: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

const statusMap: Record<string, { label: string; color: string }> = {
  pending: { label: '待处理', color: 'text-[#F59E0B] bg-[#FEF3C7]' },
  approved: { label: '已通过', color: 'text-[#10B981] bg-[#D1FAE5]' },
  rejected: { label: '已拒绝', color: 'text-[#EF4444] bg-red-50' },
}

export default function RefundManage() {
  const [refunds, setRefunds] = useState<Refund[]>([])
  const { showToast, showConfirm, markLocalAction } = useModal()
  const { markAllRead } = useUnread()

  const fetchRefunds = () => {
    request.get('/refunds').then((res: any) => setRefunds(res || []))
  }

  useEffect(() => {
    fetchRefunds()
    requestNotificationPermission()
    // 进入退款页：清零退款未读徽标
    markAllRead('refunds')
  }, [markAllRead])

  // 数据刷新订阅；toast/桌面通知由全局 NotificationCenter 统一处理
  useWebSocketEvent('refundCreated', fetchRefunds)
  useWebSocketEvent('refundUpdated', fetchRefunds)

  const handleApprove = async (id: number) => {
    showConfirm('确认通过', '确认通过该退款申请？', async () => {
      await request.post(`/refunds/${id}/status`, { status: 'approved' })
      markLocalAction(`refund:approved:${id}`)
      fetchRefunds()
      showToast('退款已通过', 'success')
    })
  }

  const handleReject = async (id: number) => {
    showConfirm('确认拒绝', '确认拒绝该退款申请？', async () => {
      await request.post(`/refunds/${id}/status`, { status: 'rejected' })
      markLocalAction(`refund:rejected:${id}`)
      fetchRefunds()
      showToast('退款已拒绝', 'success')
    })
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold text-[#0F172A] mb-6">退款/售后管理</h2>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAFC] text-[#334155]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">订单ID</th>
              <th className="text-left px-4 py-3 font-medium">退款金额</th>
              <th className="text-left px-4 py-3 font-medium">原因</th>
              <th className="text-left px-4 py-3 font-medium">状态</th>
              <th className="text-left px-4 py-3 font-medium">申请时间</th>
              <th className="text-left px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {refunds.map((refund) => {
              const s = statusMap[refund.status]
              return (
                <tr key={refund.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">#{refund.order_id}</td>
                  <td className="px-4 py-3 font-semibold text-[#EF4444]">¥{refund.amount}</td>
                  <td className="px-4 py-3 max-w-xs truncate">{refund.reason}</td>
                  <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-1 rounded-full ${s.color}`}>{s.label}</span></td>
                  <td className="px-4 py-3 text-[#94A3B8]">{new Date(refund.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {refund.status === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleApprove(refund.id)} className="p-1.5 text-[#10B981] hover:bg-[#D1FAE5] rounded transition-colors cursor-pointer" title="通过">
                          <CheckCircle size={16} />
                        </button>
                        <button onClick={() => handleReject(refund.id)} className="p-1.5 text-[#EF4444] hover:bg-red-50 rounded transition-colors cursor-pointer" title="拒绝">
                          <XCircle size={16} />
                        </button>
                      </div>
                    ) : <span className="text-xs text-[#94A3B8]">已处理</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
