import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import request from '@/api/request'
import { Users, CheckCircle, X, Minus, Plus, PlusCircle } from 'lucide-react'
import { useModal } from '@/components/ModalProvider'

interface OrderItem {
  id: number
  dish_name: string
  spec_name: string | null
  quantity: number
  price: string
  subtotal: string
}

interface CurrentOrder {
  id: number
  order_number: string
  total_amount: string
  status: string
  remark: string | null
  created_at: string
  order_items: OrderItem[]
}

interface Table {
  id: number
  table_number: string
  capacity: number
  status: 'idle' | 'occupied' | 'settled'
  current_order: CurrentOrder | null
}

const statusMap: Record<string, { label: string; bg: string; border: string; text: string; badge: string }> = {
  idle: {
    label: '空闲',
    bg: 'bg-white',
    border: 'border-gray-200',
    text: 'text-[#0F172A]',
    badge: 'text-[#10B981] bg-[#D1FAE5]',
  },
  occupied: {
    label: '用餐中',
    bg: 'bg-[#FFF7ED]',
    border: 'border-[#FDBA74]',
    text: 'text-[#9A3412]',
    badge: 'text-[#EA580C] bg-[#FFEDD5]',
  },
  settled: {
    label: '已结账',
    bg: 'bg-[#F0FDF4]',
    border: 'border-[#86EFAC]',
    text: 'text-[#166534]',
    badge: 'text-[#16A34A] bg-[#DCFCE7]',
  },
}

export default function TableBoard() {
  const navigate = useNavigate()
  const [tables, setTables] = useState<Table[]>([])
  const [selectedTable, setSelectedTable] = useState<Table | null>(null)
  const [loading, setLoading] = useState(false)
  const { showToast, showConfirm } = useModal()

  const fetchBoard = () => {
    request.get('/tables/board').then((res: any) => setTables(res || []))
  }

  useEffect(() => {
    fetchBoard()
    const timer = setInterval(fetchBoard, 5000)
    return () => clearInterval(timer)
  }, [])

  const handleSettle = async (orderId: number) => {
    showConfirm('确认结账', '确定该桌已结账吗？结账后桌台将变为空闲状态。', async () => {
      setLoading(true)
      try {
        await request.post(`/orders/${orderId}/status`, { status: 'settled' })
        setSelectedTable(null)
        fetchBoard()
        showToast('结账成功', 'success')
      } finally {
        setLoading(false)
      }
    })
  }

  const handleUpdateItemQty = async (orderId: number, itemId: number, newQty: number) => {
    if (newQty <= 0) {
      showConfirm('确认删除', '数量设为0将删除该菜品，确定吗？', async () => {
        await request.delete(`/orders/${orderId}/items/${itemId}`)
        fetchBoard()
        if (selectedTable) {
          const updated = tables.find(t => t.id === selectedTable.id)
          if (updated) setSelectedTable(updated)
        }
        showToast('菜品已删除', 'success')
      })
    } else {
      showToast('请通过「订单管理」页面修改菜品数量', 'info')
      return
    }
  }

  const totalIdle = tables.filter(t => t.status === 'idle').length
  const totalOccupied = tables.filter(t => t.status === 'occupied').length

  return (
    <div>
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl sm:text-2xl font-semibold text-[#0F172A]">桌台看板</h2>
        <button
          onClick={() => navigate('/tables')}
          className="flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] active:bg-[#1E40AF] transition-colors cursor-pointer"
        >
          <PlusCircle size={16} />
          新增桌台
        </button>
      </div>

      {/* 统计栏 */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-gray-200 shadow-sm">
          <span className="text-sm text-[#64748B]">全部</span>
          <span className="text-lg font-bold text-[#0F172A]">{tables.length}</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-gray-200 shadow-sm">
          <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" />
          <span className="text-sm text-[#64748B]">空闲</span>
          <span className="text-lg font-bold text-[#10B981]">{totalIdle}</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-gray-200 shadow-sm">
          <span className="w-2.5 h-2.5 rounded-full bg-[#EA580C]" />
          <span className="text-sm text-[#64748B]">用餐中</span>
          <span className="text-lg font-bold text-[#EA580C]">{totalOccupied}</span>
        </div>
      </div>

      {/* 桌台网格 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
        {tables.map((table) => {
          const s = statusMap[table.status]
          const order = table.current_order
          return (
            <button
              key={table.id}
              onClick={() => setSelectedTable(table)}
              className={`relative flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all active:scale-95 cursor-pointer min-h-[120px] sm:min-h-[140px] ${s.bg} ${s.border} hover:shadow-md`}
            >
              <span className={`text-2xl sm:text-3xl font-bold ${s.text}`}>{table.table_number}</span>
              <div className="flex items-center gap-1 mt-1.5 text-xs text-[#64748B]">
                <Users size={12} />
                <span>{table.capacity}人</span>
              </div>
              <span className={`mt-2 text-xs font-medium px-2.5 py-0.5 rounded-full ${s.badge}`}>
                {s.label}
              </span>
              {order && (
                <div className="mt-1.5 text-sm font-semibold text-[#EA580C]">
                  ¥{order.total_amount}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* 订单详情弹窗 */}
      {selectedTable && selectedTable.current_order && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl">
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-[#0F172A]">
                  {selectedTable.table_number}号桌
                </h3>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  订单号：{selectedTable.current_order.order_number}
                </p>
              </div>
              <button
                onClick={() => setSelectedTable(null)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* 菜品列表 */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {selectedTable.current_order.order_items.length === 0 ? (
                <div className="text-center text-sm text-[#94A3B8] py-8">暂无菜品</div>
              ) : (
                <div className="space-y-3">
                  {selectedTable.current_order.order_items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-[#0F172A] truncate">
                          {item.dish_name}
                          {item.spec_name && (
                            <span className="text-xs text-[#94A3B8] ml-1">({item.spec_name})</span>
                          )}
                        </div>
                        <div className="text-xs text-[#94A3B8] mt-0.5">
                          ¥{item.price} × {item.quantity}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        <div className="text-sm font-semibold text-[#0F172A]">¥{item.subtotal}</div>
                        <button
                          onClick={() => handleUpdateItemQty(selectedTable.current_order!.id, item.id, item.quantity - 1)}
                          className="p-1.5 text-[#EF4444] hover:bg-red-50 rounded-md cursor-pointer"
                        >
                          <Minus size={14} />
                        </button>
                        <button
                          onClick={() => handleUpdateItemQty(selectedTable.current_order!.id, item.id, item.quantity + 1)}
                          className="p-1.5 text-[#2563EB] hover:bg-[#EFF6FF] rounded-md cursor-pointer"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedTable.current_order.remark && (
                <div className="mt-3 text-xs text-[#94A3B8] bg-[#F8FAFC] p-2.5 rounded-lg">
                  备注：{selectedTable.current_order.remark}
                </div>
              )}
            </div>

            {/* 底部操作 */}
            <div className="px-5 py-4 border-t border-gray-100 shrink-0 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#64748B]">合计</span>
                <span className="text-xl font-bold text-[#EA580C]">
                  ¥{selectedTable.current_order.total_amount}
                </span>
              </div>
              <button
                onClick={() => handleSettle(selectedTable.current_order!.id)}
                disabled={loading}
                className="w-full py-3 bg-[#2563EB] text-white rounded-xl text-sm font-medium hover:bg-[#1D4ED8] active:bg-[#1E40AF] transition-colors cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <CheckCircle size={18} />
                {loading ? '处理中...' : '确认结账'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 空闲桌台点击弹窗（仅显示信息） */}
      {selectedTable && !selectedTable.current_order && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-sm p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[#0F172A]">{selectedTable.table_number}号桌</h3>
              <button onClick={() => setSelectedTable(null)} className="p-2 hover:bg-gray-100 rounded-full cursor-pointer">
                <X size={20} />
              </button>
            </div>
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-[#D1FAE5] rounded-full flex items-center justify-center mx-auto mb-3">
                <Users size={28} className="text-[#10B981]" />
              </div>
              <p className="text-[#64748B] text-sm">该桌台当前空闲，可容纳 {selectedTable.capacity} 人</p>
            </div>
            <button
              onClick={() => setSelectedTable(null)}
              className="w-full py-2.5 bg-gray-100 text-[#334155] rounded-lg text-sm font-medium hover:bg-gray-200 cursor-pointer"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
