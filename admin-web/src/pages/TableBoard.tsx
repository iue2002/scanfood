import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import request from '@/api/request'
import { ArrowLeft, CheckCircle, Minus, Plus, PlusCircle, RefreshCw, Search, ShoppingCart, Utensils, Users, WifiOff, X } from 'lucide-react'
import { useModal } from '@/components/ModalProvider'
import { useWebSocketEvent, useWebSocketReconnect } from '@/components/WebSocketProvider'
import { requestNotificationPermission } from '@/utils/notification'

function generateIdempotencyKey(): string {
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
}

interface OrderItem {
  id: number
  dish_id: number
  dish_name: string
  spec_name: string | null
  quantity: number
  price: string
  subtotal: string
  created_at?: string
  phase: 'order' | 'add_more'
  add_more_round: number
  added_by_nickname?: string | null
  served_at: string | null
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

interface Dish {
  id: number
  name: string
  price: string
  category_id: number
  category_name?: string
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
    label: '待上菜',
    bg: 'bg-[#FEF2F2]',
    border: 'border-[#FCA5A5]',
    text: 'text-[#991B1B]',
    badge: 'text-[#EF4444] bg-[#FEE2E2]',
  },
  served: {
    label: '已上菜',
    bg: 'bg-[#EFF6FF]',
    border: 'border-[#93C5FD]',
    text: 'text-[#1E40AF]',
    badge: 'text-[#2563EB] bg-[#DBEAFE]',
  },
  settled: {
    label: '已结账',
    bg: 'bg-[#F0FDF4]',
    border: 'border-[#86EFAC]',
    text: 'text-[#166534]',
    badge: 'text-[#16A34A] bg-[#DCFCE7]',
  },
}

const getServedStatus = (order: CurrentOrder | null) => {
  if (!order) return { isAllServed: false, servedCount: 0, totalCount: 0 }
  const totalCount = order.order_items.length
  const servedCount = order.order_items.filter((item) => item.served_at).length
  return {
    isAllServed: totalCount > 0 && servedCount === totalCount,
    servedCount,
    totalCount,
  }
}

export default function TableBoard() {
  const navigate = useNavigate()
  const [tables, setTables] = useState<Table[]>([])
  const [selectedTable, setSelectedTable] = useState<Table | null>(null)
  const [settleTable, setSettleTable] = useState<Table | null>(null)
  const [addDishTable, setAddDishTable] = useState<Table | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [dishes, setDishes] = useState<Dish[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [addDishCart, setAddDishCart] = useState<Record<number, { dish: Dish; quantity: number }>>({})
  const { showToast, showConfirm, markLocalAction } = useModal()

  const fetchBoard = useCallback(async () => {
    setFetchError(null)
    try {
      const res = await request.get('/tables/board')
      setTables(res.data || [])
    } catch (err: any) {
      const msg = err?.message || err?.msg || '无法连接服务器，请检查后端服务是否启动'
      setFetchError(msg)
    }
  }, [])

  const syncTableOrder = useCallback((tableId: number, nextOrder: CurrentOrder | null) => {
    setTables((prev) =>
      prev.map((table) =>
        table.id === tableId
          ? {
              ...table,
              status: nextOrder ? 'occupied' : 'idle',
              current_order: nextOrder,
            }
          : table,
      ),
    )

    const patchOpenTable = (table: Table | null): Table | null => {
      if (!table || table.id !== tableId) return table
      return {
        ...table,
        status: nextOrder ? 'occupied' : 'idle',
        current_order: nextOrder,
      } as Table
    }

    setSelectedTable((prev) => patchOpenTable(prev))
    setSettleTable((prev) => patchOpenTable(prev))
    setAddDishTable((prev) => patchOpenTable(prev))
  }, [])

  const closeAddDishModal = useCallback(() => {
    setAddDishTable(null)
    setSearchQuery('')
    setAddDishCart({})
  }, [])

  useEffect(() => {
    fetchBoard()
    requestNotificationPermission()
  }, [fetchBoard])

  useEffect(() => {
    if (!selectedTable) return
    const latestTable = tables.find((table) => table.id === selectedTable.id) || null
    setSelectedTable(latestTable)
  }, [tables, selectedTable?.id])

  useEffect(() => {
    if (!settleTable) return
    const latestTable = tables.find((table) => table.id === settleTable.id) || null
    setSettleTable(latestTable?.current_order ? latestTable : null)
  }, [tables, settleTable?.id])

  useEffect(() => {
    if (!addDishTable) return
    const latestTable = tables.find((table) => table.id === addDishTable.id) || null
    setAddDishTable(latestTable?.current_order ? latestTable : null)
  }, [tables, addDishTable?.id])

  // 数据刷新订阅；toast/桌面通知由全局 NotificationCenter 统一处理
  useWebSocketEvent('orderUpdated', fetchBoard)
  useWebSocketEvent('orderStatusChanged', fetchBoard)
  useWebSocketEvent('orderDeleted', fetchBoard)
  useWebSocketEvent('orderItemServedChanged', fetchBoard)
  useWebSocketEvent('refundCreated', fetchBoard)
  useWebSocketEvent('refundUpdated', fetchBoard)
  // ws 断线重连后补拉一次（防丢消息）
  useWebSocketReconnect(fetchBoard)

  const loadDishes = useCallback(async () => {
    const res = await request.get('/dishes')
    if (Array.isArray(res)) {
      setDishes(res)
    } else {
      setDishes(res?.data || [])
    }
  }, [])

  useEffect(() => {
    if (addDishTable?.current_order) {
      loadDishes()
    }
  }, [addDishTable, loadDishes])

  const updateCartItem = (dish: Dish, delta: number) => {
    setAddDishCart((prev) => {
      const current = prev[dish.id]
      if (current) {
        const nextQty = current.quantity + delta
        if (nextQty <= 0) {
          const next = { ...prev }
          delete next[dish.id]
          return next
        }
        return { ...prev, [dish.id]: { ...current, quantity: nextQty } }
      }
      if (delta > 0) {
        return { ...prev, [dish.id]: { dish, quantity: 1 } }
      }
      return prev
    })
  }

  const setCartItemQty = (dish: Dish, quantity: number) => {
    const safeQty = Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0
    setAddDishCart((prev) => {
      if (safeQty <= 0) {
        const next = { ...prev }
        delete next[dish.id]
        return next
      }
      return { ...prev, [dish.id]: { dish, quantity: safeQty } }
    })
  }

  const getCartTotal = () => {
    return Object.values(addDishCart).reduce((sum, item) => sum + parseFloat(item.dish.price) * item.quantity, 0)
  }

  const getCartCount = () => {
    return Object.values(addDishCart).reduce((sum, item) => sum + item.quantity, 0)
  }

  const handleAddDish = async () => {
    if (!addDishTable?.current_order) return
    setLoading(true)
    try {
      const cartItems = Object.values(addDishCart)
      if (cartItems.length === 0) {
        showToast('请先选择菜品', 'info')
        return
      }

      const orderId = addDishTable.current_order.id
      const tableId = addDishTable.id

      await request.post(`/orders/${orderId}/sync-add-more`, {
        items: cartItems.map((item) => ({
          dish_id: item.dish.id,
          dish_name: item.dish.name,
          price: parseFloat(item.dish.price),
          quantity: item.quantity,
          added_by_nickname: '商家',
        })),
        idempotency_key: generateIdempotencyKey(),
      })

      const updatedOrder = (await request.get(`/orders/${orderId}`)) as CurrentOrder
      syncTableOrder(tableId, updatedOrder)
      closeAddDishModal()
      fetchBoard()
      showToast(`加餐成功（${cartItems.length}个菜品）`, 'success')
    } finally {
      setLoading(false)
    }
  }

  const handleSettle = async () => {
    if (!settleTable?.current_order) return
    const orderId = settleTable.current_order.id
    setLoading(true)
    try {
      await request.post(`/orders/${orderId}/status`, { status: 'settled', idempotency_key: generateIdempotencyKey() })
      markLocalAction(`order:settled:${orderId}`)
      setSelectedTable(null)
      setSettleTable(null)
      closeAddDishModal()
      fetchBoard()
      showToast('结账成功', 'success')
    } finally {
      setLoading(false)
    }
  }

  const toggleServedStatus = async (tableId: number, orderId: number, item: OrderItem, served: boolean) => {
    setLoading(true)
    try {
      const updatedOrder = (await request.post(`/orders/${orderId}/items/${item.id}/served`, { served })) as CurrentOrder
      syncTableOrder(tableId, updatedOrder)
      fetchBoard()
      showToast(served ? '已标记为已上菜' : '已恢复为未上菜', 'success')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleServed = (tableId: number, orderId: number, item: OrderItem) => {
    if (!item.served_at) {
      toggleServedStatus(tableId, orderId, item, true)
      return
    }

    showConfirm('取消已上菜', `确认将“${item.dish_name}”恢复为未上菜状态？`, async () => {
      await toggleServedStatus(tableId, orderId, item, false)
    })
  }

  const filteredDishes = dishes.filter((dish) => dish.name.toLowerCase().includes(searchQuery.toLowerCase()))
  const totalIdle = tables.filter((table) => table.status === 'idle').length
  const totalOccupied = tables.filter((table) => {
    const order = table.current_order
    if (!order || table.status !== 'occupied') return false
    const { isAllServed } = getServedStatus(order)
    return !isAllServed
  }).length
  const totalServed = tables.filter((table) => {
    const order = table.current_order
    if (!order || table.status !== 'occupied') return false
    const { isAllServed } = getServedStatus(order)
    return isAllServed
  }).length

  const selectedOrder = selectedTable?.current_order || null
  const settleOrder = settleTable?.current_order || null
  const servedCount = selectedOrder?.order_items.filter((item) => Boolean(item.served_at)).length || 0
  const selectedOrderItems = useMemo(
    () => [...(selectedOrder?.order_items || [])].sort((a, b) => a.add_more_round - b.add_more_round),
    [selectedOrder?.order_items],
  )
  const settleOrderItems = useMemo(
    () => [...(settleOrder?.order_items || [])].sort((a, b) => a.add_more_round - b.add_more_round),
    [settleOrder?.order_items],
  )

  return (
    <div>
      <div className="flex items-center gap-2 sm:gap-3 mb-5 overflow-x-auto">
        <div className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-white rounded-lg border border-gray-200 shadow-sm flex-shrink-0">
          <span className="text-xs text-[#64748B]">全部</span>
          <span className="text-base font-bold text-[#0F172A]">{tables.length}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-white rounded-lg border border-gray-200 shadow-sm flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-[#10B981]" />
          <span className="text-xs text-[#64748B]">空闲</span>
          <span className="text-base font-bold text-[#10B981]">{totalIdle}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-white rounded-lg border border-gray-200 shadow-sm flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
          <span className="text-xs text-[#64748B]">待上菜</span>
          <span className="text-base font-bold text-[#EF4444]">{totalOccupied}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-white rounded-lg border border-gray-200 shadow-sm flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-[#2563EB]" />
          <span className="text-xs text-[#64748B]">已上菜</span>
          <span className="text-base font-bold text-[#2563EB]">{totalServed}</span>
        </div>
      </div>

      {fetchError ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-full bg-[#FEF2F2] flex items-center justify-center">
            <WifiOff className="w-8 h-8 text-[#EF4444]" />
          </div>
          <div className="text-center">
            <h3 className="text-base font-semibold text-[#0F172A] mb-1">加载失败</h3>
            <p className="text-sm text-[#64748B] max-w-sm">{fetchError}</p>
          </div>
          <button
            onClick={fetchBoard}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors"
          >
            <RefreshCw size={16} />
            重新加载
          </button>
        </div>
      ) : tables.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-full bg-[#F1F5F9] flex items-center justify-center">
            <Utensils className="w-8 h-8 text-[#94A3B8]" />
          </div>
          <div className="text-center">
            <h3 className="text-base font-semibold text-[#0F172A] mb-1">暂无桌台</h3>
            <p className="text-sm text-[#64748B]">请先新增桌台，再进行点餐</p>
          </div>
          <button
            onClick={() => navigate('/admin/tables')}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors"
          >
            <PlusCircle size={16} />
            新增桌台
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-2.5">
          {tables.map((table) => {
            const order = table.current_order
            const { isAllServed } = getServedStatus(order)

            let statusKey: keyof typeof statusMap = table.status
            if (order && table.status === 'occupied' && isAllServed) {
              statusKey = 'served'
            }

            const status = statusMap[statusKey]

            return (
              <div
                key={table.id}
                onClick={() => setSelectedTable(table)}
                className={`relative flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all active:scale-[0.99] cursor-pointer min-h-[100px] sm:min-h-[120px] ${status.bg} ${status.border} hover:shadow-md`}
              >
                <span className={`text-xl sm:text-2xl font-bold ${status.text}`}>{table.table_number}</span>
                <span className={`mt-1 text-[10px] sm:text-[11px] font-medium px-1.5 sm:px-2 py-0.5 rounded-full whitespace-nowrap ${status.badge}`}>
                  {status.label}
                </span>
                {order && <div className="mt-1 text-xs font-semibold text-[#EA580C]">¥{order.total_amount}</div>}
                {order && (
                  <div className="mt-2 flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    <button
                      onClick={() => setAddDishTable(table)}
                      className="px-2 py-1 text-[11px] bg-[#F8FAFC] text-[#334155] rounded-md hover:bg-[#F1F5F9] cursor-pointer"
                      disabled={loading || order.status === 'settled'}
                    >
                      加餐
                    </button>
                    <button
                      onClick={() => setSettleTable(table)}
                      className="px-2 py-1 text-[11px] bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8] cursor-pointer"
                      disabled={loading || order.status === 'settled'}
                    >
                      结账
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {selectedTable && selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3" onClick={() => setSelectedTable(null)}>
          <div className="bg-white rounded-xl overflow-hidden w-full max-w-2xl max-h-[85vh] flex flex-col shadow-lg border border-gray-100" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-[#0F172A]">{selectedTable.table_number}号桌</h3>
                <span className="px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#64748B] text-xs">
                  出餐管理
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#EF4444]">待上菜 {selectedOrder.order_items.length - servedCount}</span>
                <span className="text-[#10B981]">已上菜 {servedCount}</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 bg-white">
              {selectedOrderItems.length === 0 ? (
                <div className="text-center text-sm text-[#94A3B8] py-8">暂无待处理菜品</div>
              ) : (
                <div className="bg-white rounded-lg border border-gray-100">
                  <div className="p-2">
                    {(() => {
                      const elems: React.ReactNode[] = []
                      let prevRound = -1
                      selectedOrderItems.forEach((item, ii) => {
                        if (item.add_more_round !== prevRound && item.add_more_round > 0) {
                          elems.push(
                            <div key={`sep-${item.add_more_round}`} className="text-xs font-medium text-[#F59E0B] px-1 pt-2 mt-1 border-t border-amber-100">
                              第{item.add_more_round}次加餐
                            </div>
                          )
                        }
                        prevRound = item.add_more_round
                        elems.push(
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleToggleServed(selectedTable.id, selectedOrder.id, item)}
                            disabled={loading}
                            className={`w-full text-left rounded-lg border px-3 py-2.5 transition-all cursor-pointer disabled:opacity-60 mt-1.5 ${ii === 0 ? 'mt-0' : ''} ${
                              item.served_at
                                ? 'border-green-200 bg-green-50'
                                : 'border-blue-200 bg-blue-50 hover:border-blue-300'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                                    item.served_at ? 'bg-green-500 text-white' : 'border border-blue-400 text-transparent'
                                  }`}
                                >
                                  <CheckCircle size={10} />
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="text-sm font-medium text-[#0F172A] truncate">{item.dish_name}</span>
                                    <span className={`text-sm font-bold flex-shrink-0 bidi-iso ${item.served_at ? 'text-green-600' : 'text-blue-600'}`}>
                                      ×{item.quantity}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    {item.spec_name && (
                                      <span className="text-xs text-[#64748B]">{item.spec_name}</span>
                                    )}
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                                      item.served_at ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                                    }`}>
                                      {item.served_at ? '已上菜' : '待上菜'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </button>
                        )
                      })
                      return elems
                    })()}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 bg-white px-4 py-3">
              <button
                onClick={() => setSelectedTable(null)}
                className="w-full py-2 rounded-lg bg-[#F1F5F9] text-[#334155] text-sm font-medium hover:bg-[#E2E8F0] transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <ArrowLeft size={14} />
                返回
              </button>
            </div>
          </div>
        </div>
      )}

      {settleTable && settleOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4" onClick={() => setSettleTable(null)}>
          <div className="bg-white rounded-3xl overflow-hidden w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0 bg-white">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-[#0F172A]">{settleTable.table_number}号桌结账详情</h3>
                <p className="text-xs text-[#94A3B8] mt-1">订单号：{settleOrder.order_number}</p>
              </div>
              <button
                onClick={() => setSettleTable(null)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 bg-[#F8FAFC]">
              <div className="space-y-4">
                <div className="bg-white rounded-3xl border border-[#E2E8F0] overflow-hidden">
                  <div className="px-4 py-2">
                    {(() => {
                      const elems: React.ReactNode[] = []
                      let prevRound = -1
                      settleOrderItems.forEach((item, ii) => {
                        if (item.add_more_round !== prevRound && item.add_more_round > 0) {
                          elems.push(
                            <div key={`sep-${item.add_more_round}`} className="text-xs font-medium text-[#F59E0B] pt-2 mt-1 border-t border-amber-100">
                              第{item.add_more_round}次加餐
                            </div>
                          )
                        }
                        prevRound = item.add_more_round
                        elems.push(
                          <div key={item.id} className="flex items-start justify-between gap-4 py-3 border-b border-[#F1F5F9] last:border-0">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-[#0F172A]">{item.dish_name}</span>
                                {item.spec_name && <span className="text-xs text-[#94A3B8]">({item.spec_name})</span>}
                                <span className={`text-xs px-2 py-1 rounded-full ${item.served_at ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#FEF3C7] text-[#92400E]'}`}>
                                  {item.served_at ? '已上菜' : '未上菜'}
                                </span>
                              </div>
                              <div className="mt-1 text-sm text-[#64748B]">
                                单价 ¥{item.price} × {item.quantity}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-semibold text-[#0F172A]">¥{item.subtotal}</div>
                            </div>
                          </div>
                        )
                      })
                      return elems
                    })()}
                  </div>
                </div>

                {settleOrder.remark && (
                  <div className="bg-white rounded-3xl border border-[#E2E8F0] p-4">
                    <div className="text-xs text-[#94A3B8] mb-1">备注</div>
                    <div className="text-sm text-[#334155]">{settleOrder.remark}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-gray-100 bg-white px-5 py-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#64748B]">合计</span>
                <span className="text-2xl font-bold text-[#EA580C]">¥{settleOrder.total_amount}</span>
              </div>
              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <button
                  onClick={() => setSettleTable(null)}
                  className="flex-1 py-3 bg-[#F1F5F9] text-[#334155] rounded-2xl text-sm font-medium hover:bg-[#E2E8F0] transition-colors cursor-pointer"
                >
                  关闭
                </button>
                <button
                  onClick={handleSettle}
                  disabled={loading}
                  className="flex-1 py-3 bg-[#2563EB] text-white rounded-2xl text-sm font-medium hover:bg-[#1D4ED8] transition-colors cursor-pointer disabled:opacity-60"
                >
                  {loading ? '处理中...' : '确认结账'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {addDishTable?.current_order && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4" onClick={() => setAddDishTable(null)}>
          <div className="bg-white rounded-3xl overflow-hidden w-full max-w-lg max-h-[78vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-[#0F172A]">选择菜品加餐</h3>
                <p className="text-xs text-[#94A3B8] mt-1">{addDishTable.table_number}号桌</p>
              </div>
              <button
                onClick={closeAddDishModal}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-gray-100 shrink-0">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  type="text"
                  placeholder="搜索菜品..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-[#F8FAFC] border-0 rounded-lg text-sm placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3 bg-[#F8FAFC]">
              {filteredDishes.length === 0 ? (
                <div className="text-center text-sm text-[#94A3B8] py-8">
                  {searchQuery ? '未找到匹配的菜品' : '暂无菜品'}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredDishes.map((dish) => {
                    const cartItem = addDishCart[dish.id]
                    const qty = cartItem?.quantity || 0
                    return (
                      <div key={dish.id} className="flex items-center justify-between p-3 bg-white border border-[#E2E8F0] rounded-2xl">
                        <div className="flex-1 min-w-0 pr-3">
                          <div className="font-medium text-sm text-[#0F172A] truncate">{dish.name}</div>
                          <div className="text-xs text-[#94A3B8] mt-1">¥{dish.price}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="number"
                            min={0}
                            value={qty === 0 ? '' : qty}
                            placeholder="0"
                            onChange={(event) => setCartItemQty(dish, Number(event.target.value))}
                            onBlur={(event) => {
                              if (event.target.value === '') {
                                setCartItemQty(dish, 0)
                              }
                            }}
                            className="w-16 px-2 py-1 text-sm border border-gray-200 rounded-lg text-center bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                          />
                          <button
                            onClick={() => updateCartItem(dish, -1)}
                            className="w-8 h-8 flex items-center justify-center bg-gray-200 text-[#334155] rounded-lg hover:bg-gray-300 cursor-pointer"
                          >
                            <Minus size={14} />
                          </button>
                          <button
                            onClick={() => updateCartItem(dish, 1)}
                            className="w-8 h-8 flex items-center justify-center bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] cursor-pointer"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 shrink-0 bg-white">
              {Object.keys(addDishCart).length > 0 && (
                <div className="mb-3 p-3 bg-[#FEF3C7] rounded-2xl">
                  <div className="flex items-center justify-between text-xs text-[#92400E] mb-2">
                    <span>已选菜品</span>
                    <span>合计 ¥{getCartTotal().toFixed(2)}</span>
                  </div>
                  <div className="space-y-1">
                    {Object.values(addDishCart).map((item) => (
                      <div key={item.dish.id} className="flex justify-between text-xs text-[#92400E]">
                        <span>{item.dish.name} x{item.quantity}</span>
                        <span>¥{(parseFloat(item.dish.price) * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <button
                  onClick={closeAddDishModal}
                  className="flex-1 py-3 bg-gray-100 text-[#334155] rounded-2xl text-sm font-medium hover:bg-gray-200 cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={handleAddDish}
                  disabled={loading || Object.keys(addDishCart).length === 0}
                  className="flex-1 py-3 bg-[#10B981] text-white rounded-2xl text-sm font-medium hover:bg-[#059669] transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <ShoppingCart size={16} />
                  {loading ? '提交中...' : `确认加餐（${getCartCount()}件）`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedTable && !selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedTable(null)}>
          <div className="bg-white rounded-3xl overflow-hidden w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-5">
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
                className="w-full py-3 bg-gray-100 text-[#334155] rounded-2xl text-sm font-medium hover:bg-gray-200 cursor-pointer"
              >
                返回
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatDateTime(dateStr?: string | null) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
