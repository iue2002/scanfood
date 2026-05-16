import { useEffect, useState, useCallback } from 'react'
import request from '@/api/request'
import { CheckCircle, XCircle, Eye } from 'lucide-react'
import { useModal } from '@/components/ModalProvider'
import { useWebSocket } from '@/hooks/useWebSocket'

interface Order {
  id: number
  order_number: string
  table_id: number
  tables?: { table_number: string }
  total_amount: string
  status: string
  created_at: string
  remark?: string
  order_items?: Array<{
    dish_name: string
    spec_name?: string
    quantity: number
    price: string
    subtotal: string
  }>
}

const statusMap: Record<string, { label: string; color: string }> = {
  submitted: { label: '已提交', color: 'text-[#F59E0B] bg-[#FEF3C7]' },
  printed: { label: '已打印', color: 'text-[#2563EB] bg-[#EFF6FF]' },
  settled: { label: '已结账', color: 'text-[#10B981] bg-[#D1FAE5]' },
  cancelled: { label: '已取消', color: 'text-[#EF4444] bg-red-50' },
  refunded: { label: '已退款', color: 'text-[#94A3B8] bg-[#F1F5F9]' },
}

export default function OrderManage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [filterStatus, setFilterStatus] = useState('')
  const [detail, setDetail] = useState<Order | null>(null)
  const { showToast, showConfirm } = useModal()

  const fetchOrders = useCallback(() => {
    const params: any = {}
    if (filterStatus) params.status = filterStatus
    request.get('/orders', { params }).then((res: any) => setOrders(res || []))
  }, [filterStatus])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  const handleWebSocketMessage = useCallback((event: string, data: any) => {
    if (event === 'orderUpdated' || event === 'orderStatusChanged') {
      fetchOrders()
    } else if (event === 'orderDeleted') {
      setOrders(prev => prev.filter(o => o.id !== data.id))
    }
  }, [fetchOrders])

  useWebSocket({
    onMessage: handleWebSocketMessage,
    autoReconnect: true,
    reconnectInterval: 5000
  })

  const handleSettle = async (id: number) => {
    showConfirm('确认结账', '确认标记该订单为已结账？', async () => {
      await request.post(`/orders/${id}/status`, { status: 'settled' })
      fetchOrders()
      showToast('订单已结账', 'success')
    })
  }

  const handleCancel = async (id: number) => {
    showConfirm('确认取消', '确认取消该订单？', async () => {
      await request.post(`/orders/${id}/status`, { status: 'cancelled' })
      fetchOrders()
      showToast('订单已取消', 'success')
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-[#0F172A]">订单管理</h2>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
        >
          <option value="">全部状态</option>
          <option value="submitted">已提交</option>
          <option value="printed">已打印</option>
          <option value="settled">已结账</option>
          <option value="cancelled">已取消</option>
          <option value="refunded">已退款</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAFC] text-[#334155]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">订单号</th>
              <th className="text-left px-4 py-3 font-medium">桌台</th>
              <th className="text-left px-4 py-3 font-medium">金额</th>
              <th className="text-left px-4 py-3 font-medium">状态</th>
              <th className="text-left px-4 py-3 font-medium">下单时间</th>
              <th className="text-left px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const s = statusMap[order.status] || statusMap.submitted
              return (
                <tr key={order.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono">{order.order_number}</td>
                  <td className="px-4 py-3">{order.tables?.table_number || '-'}</td>
                  <td className="px-4 py-3 font-semibold">¥{order.total_amount}</td>
                  <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-1 rounded-full ${s.color}`}>{s.label}</span></td>
                  <td className="px-4 py-3 text-[#94A3B8]">{new Date(order.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setDetail(order)} className="p-1.5 text-[#2563EB] hover:bg-[#EFF6FF] rounded transition-colors cursor-pointer" title="查看详情">
                        <Eye size={16} />
                      </button>
                      {order.status === 'submitted' || order.status === 'printed' ? (
                        <>
                          <button onClick={() => handleSettle(order.id)} className="p-1.5 text-[#10B981] hover:bg-[#D1FAE5] rounded transition-colors cursor-pointer" title="标记结账">
                            <CheckCircle size={16} />
                          </button>
                          <button onClick={() => handleCancel(order.id)} className="p-1.5 text-[#EF4444] hover:bg-red-50 rounded transition-colors cursor-pointer" title="取消订单">
                            <XCircle size={16} />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-xl max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">订单详情</h3>
              <button onClick={() => setDetail(null)} className="text-[#94A3B8] hover:text-[#0F172A] cursor-pointer">✕</button>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm"><span className="text-[#94A3B8]">订单号</span><span>{detail.order_number}</span></div>
              <div className="flex justify-between text-sm"><span className="text-[#94A3B8]">桌台</span><span>{detail.tables?.table_number}</span></div>
              <div className="flex justify-between text-sm"><span className="text-[#94A3B8]">状态</span><span>{statusMap[detail.status]?.label}</span></div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-sm font-medium mb-2">菜品明细</p>
                {detail.order_items?.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm py-1">
                    <span>{item.dish_name} {item.spec_name ? `(${item.spec_name})` : ''} × {item.quantity}</span>
                    <span>¥{item.subtotal}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-base font-bold border-t border-gray-100 pt-3">
                <span>合计</span>
                <span className="text-[#2563EB]">¥{detail.total_amount}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
