import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import request from '@/api/request'
import { Users, CheckCircle, X, Minus, Plus, PlusCircle, Search, ShoppingCart } from 'lucide-react'
import { useModal } from '@/components/ModalProvider'
import { useWebSocket } from '@/hooks/useWebSocket'

interface OrderItem {
  id: number
  dish_id: number
  dish_name: string
  spec_name: string | null
  quantity: number
  price: string
  subtotal: string
  created_at?: string
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
  const [showAddDish, setShowAddDish] = useState(false)
  const [dishes, setDishes] = useState<Dish[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [addDishCart, setAddDishCart] = useState<Record<number, { dish: Dish; quantity: number }>>({})
  const { showToast, showConfirm } = useModal()

  const fetchBoard = useCallback(async () => {
    const res = await request.get('/tables/board')
    setTables(res.data || [])
  }, [])

  useEffect(() => {
    fetchBoard()
  }, [fetchBoard])

  const handleWebSocketMessage = useCallback((event: string, data: any) => {
    if (event === 'orderUpdated' || event === 'orderStatusChanged' || event === 'orderDeleted') {
      fetchBoard()
    }
  }, [fetchBoard])

  useWebSocket({
    onMessage: handleWebSocketMessage,
    autoReconnect: true,
    reconnectInterval: 5000
  })

  const handleSettle = async (orderId: number) => {
    setLoading(true)
    try {
      await request.post(`/orders/${orderId}/status`, { status: 'settled' })
      setSelectedTable(null)
      fetchBoard()
      showToast('结账成功', 'success')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateItemQty = async (orderId: number, itemId: number, newQty: number) => {
    if (newQty <= 0) {
      showConfirm('确认删除', '确定删除该菜品吗？', async () => {
        setLoading(true)
        try {
          await request.delete(`/orders/${orderId}/items/${itemId}`)
          fetchBoard()
          if (selectedTable) {
            const updated = tables.find(t => t.id === selectedTable.id)
            if (updated) setSelectedTable(updated)
          }
          showToast('菜品已删除', 'success')
        } finally {
          setLoading(false)
        }
      })
    } else {
      setLoading(true)
      try {
        await request.put(`/orders/${orderId}/items/${itemId}`, { quantity: newQty })
        fetchBoard()
        if (selectedTable) {
          const updated = tables.find(t => t.id === selectedTable.id)
          if (updated) setSelectedTable(updated)
        }
        showToast('数量已更新', 'success')
      } finally {
        setLoading(false)
      }
    }
  }

  const handleAddDish = async (orderId: number, dishId: number, dishName: string, price: string) => {
    setLoading(true)
    try {
      // 批量提交购物车中的所有菜品
      const cartItems = Object.values(addDishCart)
      if (cartItems.length === 0) {
        showToast('请先选择菜品', 'info')
        return
      }
      
      await request.post(`/orders/${orderId}/sync-add-more`, {
        items: cartItems.map(item => ({
          dish_id: item.dish.id,
          dish_name: item.dish.name,
          price: parseFloat(item.dish.price),
          quantity: item.quantity,
          added_by_nickname: '商家' // 标记商家加餐
        }))
      })
      
      // 直接获取更新后的订单信息
      const updatedOrder = await (request.get(`/orders/${orderId}`) as any) as CurrentOrder
      // 更新选中的桌台数据
      if (selectedTable) {
        setSelectedTable({
          ...selectedTable,
          current_order: updatedOrder
        })
      }
      // 清空购物车并关闭弹窗
      setAddDishCart({})
      setShowAddDish(false)
      setSearchQuery('')
      // 同时刷新桌台看板数据
      fetchBoard()
      showToast(`加餐成功（${cartItems.length}个菜品）`, 'success')
    } finally {
      setLoading(false)
    }
  }

  // 购物车操作
  const updateCartItem = (dish: Dish, delta: number) => {
    setAddDishCart(prev => {
      const current = prev[dish.id]
      if (current) {
        const newQty = current.quantity + delta
        if (newQty <= 0) {
          const newCart = { ...prev }
          delete newCart[dish.id]
          return newCart
        }
        return { ...prev, [dish.id]: { ...current, quantity: newQty } }
      } else if (delta > 0) {
        return { ...prev, [dish.id]: { dish, quantity: 1 } }
      }
      return prev
    })
  }

  const setCartItemQty = (dish: Dish, quantity: number) => {
    const safeQty = Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0
    setAddDishCart(prev => {
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

  const loadDishes = useCallback(async () => {
    const res = await request.get('/dishes')
    if (Array.isArray(res)) {
      setDishes(res)
    } else {
      setDishes(res?.data || [])
    }
  }, [])

  useEffect(() => {
    if (showAddDish) {
      loadDishes()
    }
  }, [showAddDish, loadDishes])

  const filteredDishes = dishes.filter(d => 
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

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
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-2.5">
        {tables.map((table) => {
          const s = statusMap[table.status]
          const order = table.current_order
          return (
            <div
              key={table.id}
              onClick={() => setSelectedTable(table)}
              className={`relative flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all active:scale-[0.99] cursor-pointer min-h-[100px] sm:min-h-[120px] ${s.bg} ${s.border} hover:shadow-md`}
            >
              <span className={`text-xl sm:text-2xl font-bold ${s.text}`}>{table.table_number}</span>
              <div className="flex items-center gap-1 mt-1 text-[11px] text-[#64748B]">
                <Users size={12} />
                <span>{table.capacity}人</span>
              </div>
              <span className={`mt-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ${s.badge}`}>
                {s.label}
              </span>
              {order && (
                <div className="mt-1 text-xs font-semibold text-[#EA580C]">
                  ¥{order.total_amount}
                </div>
              )}
              {order && (
                <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => {
                      setSelectedTable(table)
                      setShowAddDish(true)
                    }}
                    className="px-2 py-1 text-[11px] bg-[#F8FAFC] text-[#334155] rounded-md hover:bg-[#F1F5F9] cursor-pointer"
                    disabled={loading || order.status === 'settled'}
                  >
                    加餐
                  </button>
                  <button
                    onClick={() => setSelectedTable(table)}
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

            {/* 菜品列表 - 按点餐时间分组 */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {selectedTable.current_order.order_items.length === 0 ? (
                <div className="text-center text-sm text-[#94A3B8] py-8">暂无菜品</div>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const items = selectedTable.current_order.order_items
                    const sorted = [...items].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
                    const groups: { label: string; time: string; items: typeof sorted }[] = []
                    let currentGroup = [sorted[0]]

                    for (let i = 1; i < sorted.length; i++) {
                      const prevTime = new Date(sorted[i - 1].created_at || 0).getTime()
                      const currTime = new Date(sorted[i].created_at || 0).getTime()
                      if (currTime - prevTime < 5 * 60 * 1000) {
                        currentGroup.push(sorted[i])
                      } else {
                        groups.push({
                          time: sorted[i - 1].created_at!,
                          items: currentGroup,
                          label: groups.length === 0 ? '首次点餐' : `第${groups.length + 1}次加餐`
                        })
                        currentGroup = [sorted[i]]
                      }
                    }
                    groups.push({
                      time: sorted[sorted.length - 1].created_at!,
                      items: currentGroup,
                      label: groups.length === 0 ? '首次点餐' : `第${groups.length + 1}次加餐`
                    })

                    return groups.map((group, gi) => (
                      <div key={gi} className="bg-[#F8FAFC] rounded-lg p-3">
                        <div className="text-xs font-medium text-[#2563EB] mb-2">
                          {group.label}
                          {group.time && (
                            <span className="text-[#94A3B8] ml-1">
                              · {new Date(group.time).toLocaleString()}
                            </span>
                          )}
                        </div>
                        <div className="space-y-2">
                          {group.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center justify-between py-1 border-b border-gray-100 last:border-0"
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
                      </div>
                    ))
                  })()}
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAddDish(true)}
                  disabled={loading || selectedTable.current_order.status === 'settled'}
                  className="flex-1 py-3 bg-[#F8FAFC] text-[#334155] rounded-xl text-sm font-medium hover:bg-[#F1F5F9] transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <PlusCircle size={18} />
                  加餐
                </button>
                <button
                  onClick={() => handleSettle(selectedTable.current_order!.id)}
                  disabled={loading}
                  className="flex-1 py-3 bg-[#2563EB] text-white rounded-xl text-sm font-medium hover:bg-[#1D4ED8] active:bg-[#1E40AF] transition-colors cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  <CheckCircle size={18} />
                  {loading ? '处理中...' : '确认结账'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 加餐弹窗 */}
      {showAddDish && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[70vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <h3 className="text-lg font-bold text-[#0F172A]">选择菜品加餐</h3>
              <button
                onClick={() => { setShowAddDish(false); setSearchQuery(''); setAddDishCart({}) }}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            
            {/* 搜索框 */}
            <div className="px-5 py-3 border-b border-gray-100 shrink-0">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
                <input
                  type="text"
                  placeholder="搜索菜品..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-[#F8FAFC] border-0 rounded-lg text-sm placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                />
              </div>
            </div>

            {/* 菜品列表 */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
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
                      <div
                        key={dish.id}
                        className="flex items-center justify-between p-3 bg-[#F8FAFC] rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-[#0F172A] truncate">{dish.name}</div>
                          <div className="text-xs text-[#94A3B8]">¥{dish.price}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            value={qty === 0 ? '' : qty}
                            placeholder="0"
                            onChange={(e) => setCartItemQty(dish, Number(e.target.value))}
                            onBlur={(e) => {
                              if (e.target.value === '') {
                                setCartItemQty(dish, 0)
                              }
                            }}
                            className="w-16 px-2 py-1 text-sm border border-gray-200 rounded-md text-center bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                          />
                          <button
                            onClick={() => updateCartItem(dish, 1)}
                            className="w-7 h-7 flex items-center justify-center bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8] cursor-pointer"
                          >
                            <Plus size={14} />
                          </button>
                          <button
                            onClick={() => updateCartItem(dish, -1)}
                            className="w-7 h-7 flex items-center justify-center bg-gray-200 text-[#334155] rounded-md hover:bg-gray-300 cursor-pointer"
                          >
                            <Minus size={14} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 底部购物车和提交 */}
            <div className="px-5 py-4 border-t border-gray-100 shrink-0 bg-white">
              {Object.keys(addDishCart).length > 0 && (
                <div className="mb-3 p-3 bg-[#FEF3C7] rounded-lg">
                  <div className="text-xs text-[#92400E] mb-1">已选菜品</div>
                  <div className="space-y-1">
                    {Object.values(addDishCart).map(item => (
                      <div key={item.dish.id} className="flex justify-between text-xs text-[#92400E]">
                        <span>{item.dish.name} x{item.quantity}</span>
                        <span>¥{(parseFloat(item.dish.price) * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setShowAddDish(false); setSearchQuery(''); setAddDishCart({}) }}
                  className="flex-1 py-3 bg-gray-100 text-[#334155] rounded-xl text-sm font-medium hover:bg-gray-200 cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={() => handleAddDish(selectedTable!.current_order!.id, 0, '', '')}
                  disabled={loading || Object.keys(addDishCart).length === 0}
                  className="flex-1 py-3 bg-[#10B981] text-white rounded-xl text-sm font-medium hover:bg-[#059669] transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <ShoppingCart size={16} />
                  {loading ? '提交中...' : `确认加餐（${getCartCount()}件）`}
                </button>
              </div>
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
