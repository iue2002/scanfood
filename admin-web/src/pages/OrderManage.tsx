import { useEffect, useState, useCallback } from 'react'
import request from '@/api/request'
import { CheckCircle, XCircle, Eye, Calendar, Tag, Filter, ChevronDown, ChevronUp, Copy, User, ChevronLeft, ChevronRight, Minus, Plus, PlusCircle, Search, ShoppingCart } from 'lucide-react'
import { useModal } from '@/components/ModalProvider'
import { useWebSocket } from '@/hooks/useWebSocket'

interface OrderItem {
  id: number
  dish_id?: number
  spec_id?: number | null
  dish_name: string
  spec_name: string | null
  quantity: number
  price: string
  subtotal: string
  added_by_user_id: number | null
  added_by_nickname: string | null
  phase: 'order' | 'add_more'
  add_more_round: number
  created_at: string
}

interface Order {
  id: number
  order_number: string
  table_id: number
  tables?: { table_number: string }
  total_amount: string
  status: string
  created_at: string
  remark?: string
  order_items?: OrderItem[]
  user?: {
    nickname?: string
    username?: string
  }
  users?: {
    nickname?: string
    username?: string
  }
}

interface Dish {
  id: number
  name: string
  price: string
  category_id: number
  category_name?: string
}

interface GroupedItems {
  time: string
  items: OrderItem[]
  label: string
  phase: 'order' | 'add_more'
}

const statusMap: Record<string, { label: string; color: string }> = {
  draft: { label: '待提交', color: 'text-[#94A3B8] bg-[#F1F5F9]' },
  submitted: { label: '已提交', color: 'text-[#F59E0B] bg-[#FEF3C7]' },
  printed: { label: '已打印', color: 'text-[#2563EB] bg-[#EFF6FF]' },
  settled: { label: '已结账', color: 'text-[#10B981] bg-[#D1FAE5]' },
  cancelled: { label: '已取消', color: 'text-[#EF4444] bg-red-50' },
  refunded: { label: '已退款', color: 'text-[#94A3B8] bg-[#F1F5F9]' },
}

const presetTags = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
]

export default function OrderManage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [filterStatus, setFilterStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [activeTag, setActiveTag] = useState('')
  const [detail, setDetail] = useState<Order | null>(null)
  const [addDishOrder, setAddDishOrder] = useState<Order | null>(null)
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set())
  const { showToast, showConfirm } = useModal()
  const [loading, setLoading] = useState(false)
  const [dishes, setDishes] = useState<Dish[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [addDishCart, setAddDishCart] = useState<Record<number, { dish: Dish; quantity: number }>>({})
  
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [hasMore, setHasMore] = useState(true)

  const fetchOrders = useCallback(() => {
    const params: any = {
      page: currentPage,
      page_size: pageSize
    }
    if (!filterStatus) {
      params.exclude_draft = 'true'
    } else if (filterStatus) {
      params.status = filterStatus
    }
    if (dateFrom) params.date_from = dateFrom
    if (dateTo) params.date_to = dateTo
    if (activeTag) params.tag = activeTag
    request.get('/orders', { params }).then((res: any) => {
      let data: Order[] = []
      if (Array.isArray(res)) {
        data = res
      } else if (res && Array.isArray(res.data)) {
        data = res.data
      }
      setOrders(data)
      setHasMore(data.length === pageSize)
      const orderIds = data.map((o: Order) => o.id)
      setExpandedOrders(new Set(orderIds))
    })
  }, [filterStatus, dateFrom, dateTo, currentPage, pageSize])

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

  const handleUpdateItemQty = async (orderId: number, itemId: number, newQty: number) => {
    if (newQty < 0) return
    setLoading(true)
    try {
      await request.put(`/orders/${orderId}/items/${itemId}`, { quantity: newQty })
      const updated = await request.get(`/orders/${orderId}`)
      if (detail && detail.id === orderId) {
        setDetail((updated as unknown as { data: Order }).data || (updated as unknown as Order))
      }
      fetchOrders()
      showToast('已更新', 'success')
    } finally {
      setLoading(false)
    }
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
    if (addDishOrder) {
      loadDishes()
    }
  }, [addDishOrder, loadDishes])

  const updateCartItem = (dish: Dish, delta: number) => {
    setAddDishCart(prev => {
      const current = prev[dish.id]
      if (current) {
        const nextQty = current.quantity + delta
        if (nextQty <= 0) {
          const next = { ...prev }
          delete next[dish.id]
          return next
        }
        return { ...prev, [dish.id]: { ...current, quantity: nextQty } }
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

  const getCartCount = () => {
    return Object.values(addDishCart).reduce((sum, item) => sum + item.quantity, 0)
  }

  const handleAddDish = async (orderId: number) => {
    setLoading(true)
    try {
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
          added_by_nickname: '商家'
        }))
      })

      const updated = await request.get(`/orders/${orderId}`)
      if (detail && detail.id === orderId) {
        setDetail((updated as unknown as { data: Order }).data || (updated as unknown as Order))
      }
      fetchOrders()
      setAddDishCart({})
      setAddDishOrder(null)
      setSearchQuery('')
      showToast('加餐成功', 'success')
    } finally {
      setLoading(false)
    }
  }

  const filteredDishes = dishes.filter(d =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const applyTag = (tagKey: string) => {
    if (activeTag === tagKey) {
      setActiveTag('')
      setDateFrom('')
      setDateTo('')
      return
    }
    setActiveTag(tagKey)
    const today = new Date()
    const formatDate = (d: Date) => d.toISOString().split('T')[0]

    switch (tagKey) {
      case 'today':
        setDateFrom(formatDate(today))
        setDateTo(formatDate(today))
        break
      case 'yesterday': {
        const yest = new Date(today)
        yest.setDate(yest.getDate() - 1)
        setDateFrom(formatDate(yest))
        setDateTo(formatDate(yest))
        break
      }
      case 'week': {
        const weekStart = new Date(today)
        weekStart.setDate(weekStart.getDate() - weekStart.getDay())
        setDateFrom(formatDate(weekStart))
        setDateTo(formatDate(today))
        break
      }
      case 'month': {
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
        setDateFrom(formatDate(monthStart))
        setDateTo(formatDate(today))
        break
      }
    }
  }

  const toggleExpand = (orderId: number) => {
    setExpandedOrders(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) {
        next.delete(orderId)
      } else {
        next.add(orderId)
      }
      return next
    })
  }

  const groupItemsByPhase = (items: OrderItem[]): GroupedItems[] => {
    if (!items || items.length === 0) return []
    const sorted = [...items].sort((a, b) => a.add_more_round - b.add_more_round)
    const groups: GroupedItems[] = []
    let currentGroup: OrderItem[] = [sorted[0]]
    let currentRound = sorted[0].add_more_round

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].add_more_round === currentRound) {
        currentGroup.push(sorted[i])
      } else {
        groups.push({
          time: currentGroup[0].created_at,
          items: currentGroup,
          label: currentRound === 0 ? '首次点餐' : `第${currentRound}次加餐`,
          phase: currentRound === 0 ? 'order' : 'add_more'
        })
        currentGroup = [sorted[i]]
        currentRound = sorted[i].add_more_round
      }
    }
    groups.push({
      time: currentGroup[0].created_at,
      items: currentGroup,
      label: currentRound === 0 ? '首次点餐' : `第${currentRound}次加餐`,
      phase: currentRound === 0 ? 'order' : 'add_more'
    })
    return groups
  }

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return ''
    const match = dateStr.match(/^\d{4}-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):\d{2}/)
    if (match) {
      return `${parseInt(match[1])}月${parseInt(match[2])}日 ${match[3]}:${match[4]}`
    }
    return dateStr
  }

  const formatFullDateTime = (dateStr: string) => {
    if (!dateStr) return ''
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/)
    if (match) {
      return `${match[1]}/${parseInt(match[2])}/${parseInt(match[3])} ${match[4]}:${match[5]}:${match[6]}`
    }
    return dateStr
  }

  const copyOrderNumber = (orderNumber: string) => {
    navigator.clipboard.writeText(orderNumber)
    showToast('订单号已复制', 'success')
  }

  const openDetail = (order: Order) => {
    setAddDishOrder(null)
    setSearchQuery('')
    setAddDishCart({})
    setDetail(order)
  }

  const openAddDish = (order: Order) => {
    setDetail(null)
    setAddDishOrder(order)
  }

  const closeAddDishModal = () => {
    setAddDishOrder(null)
    setSearchQuery('')
    setAddDishCart({})
  }

  const renderCardSeparator = (key: string) => (
    <div key={key} className="px-2">
      <div className="flex items-center gap-3 px-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#BFDBFE] to-transparent" />
        <div className="w-2.5 h-2.5 rounded-full bg-[#60A5FA]" />
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#BFDBFE] to-transparent" />
      </div>
    </div>
  )

  return (
    <div>
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="hidden lg:block text-xl font-semibold text-[#0F172A]">订单管理</h2>
      </div>

      {/* 筛选区域 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 mb-5">
        <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
          <div className="hidden lg:flex items-center gap-2 flex-shrink-0">
            <Filter size={16} className="text-[#64748B]" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            >
              <option value="">全部状态</option>
              <option value="draft">待提交</option>
              <option value="submitted">已提交</option>
              <option value="printed">已打印</option>
              <option value="settled">已结账</option>
              <option value="cancelled">已取消</option>
              <option value="refunded">已退款</option>
            </select>
          </div>

          <div className="hidden lg:flex items-center gap-2 flex-shrink-0">
            <Calendar size={16} className="text-[#64748B]" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setActiveTag('') }}
              className="px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              placeholder="开始日期"
            />
            <span className="text-[#94A3B8]">至</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setActiveTag('') }}
              className="px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              placeholder="结束日期"
            />
          </div>

          <div className="hidden lg:flex items-center gap-2 flex-shrink-0">
            <Tag size={16} className="text-[#64748B]" />
            {presetTags.map(tag => (
              <button
                key={tag.key}
                onClick={() => applyTag(tag.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTag === tag.key
                    ? 'bg-[#2563EB] text-white'
                    : 'bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]'
                }`}
              >
                {tag.label}
              </button>
            ))}
          </div>

          {(dateFrom || dateTo || filterStatus) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setFilterStatus(''); setActiveTag('') }}
              className="px-3 py-1.5 text-sm text-[#EF4444] hover:bg-red-50 rounded-lg transition-colors cursor-pointer flex-shrink-0"
            >
              清除筛选
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 overflow-x-auto whitespace-nowrap">
          {[
            { value: '', label: '全部' },
            { value: 'submitted', label: '已提交' },
            { value: 'printed', label: '已打印' },
            { value: 'unpaid', label: '待支付' },
            { value: 'settled', label: '已结账' },
            { value: 'cancelled', label: '已取消' },
            { value: 'refunded', label: '已退款' },
          ].map((item) => (
            <button
              key={item.value || 'all'}
              onClick={() => setFilterStatus(item.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                filterStatus === item.value
                  ? 'bg-[#2563EB] text-white'
                  : 'bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 订单列表 - 桌面端表格 */}
      <div className="hidden xl:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAFC] text-[#334155]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">桌台</th>
              <th className="text-left px-4 py-3 font-medium">菜品</th>
              <th className="text-left px-4 py-3 font-medium">金额</th>
              <th className="text-left px-4 py-3 font-medium">状态</th>
              <th className="text-left px-4 py-3 font-medium">下单时间</th>
              <th className="text-left px-4 py-3 font-medium">操作</th>
              <th className="text-left px-4 py-3 font-medium">订单号</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const s = statusMap[order.status] || statusMap.submitted
              const isExpanded = expandedOrders.has(order.id)
              const items = order.order_items || []
              const groupedItems = isExpanded ? groupItemsByPhase(items) : []

              return (
                <tr key={order.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-xl font-bold text-[#2563EB]">{order.tables?.table_number || '-'}</div>
                  </td>
                  <td className="px-4 py-3">
                    {!isExpanded ? (
                      <div className="text-xs text-[#64748B] max-w-[200px] truncate">
                        {items.length > 0
                          ? items.map(i => `${i.dish_name}×${i.quantity}`).join('、')
                          : '无菜品'}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {groupedItems.map((group, gi) => (
                          <div key={gi} className="bg-[#F8FAFC] rounded-lg p-2">
                            <div className="text-xs font-medium text-[#2563EB] mb-1">
                              {group.label} · {formatDateTime(group.time)}
                            </div>
                            <div className="space-y-0.5">
                              {group.items.map((item, ii) => (
                                <div key={ii} className="flex justify-between text-xs">
                                  <span className="text-[#0F172A]">
                                    {item.dish_name}
                                    {item.spec_name ? `(${item.spec_name})` : ''}
                                    <span className="text-[#64748B]"> × {item.quantity}</span>
                                  </span>
                                  <span className="text-[#64748B]">¥{item.subtotal}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => toggleExpand(order.id)}
                      className="text-xs text-[#2563EB] hover:underline mt-1 flex items-center gap-0.5 cursor-pointer"
                    >
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {isExpanded ? '收起明细' : `展开明细 (${items.length}道菜)`}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-semibold">¥{order.total_amount}</td>
                  <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-1 rounded-full ${s.color}`}>{s.label}</span></td>
                  <td className="px-4 py-3 text-[#94A3B8]">{formatFullDateTime(order.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openDetail(order)} className="p-1.5 text-[#2563EB] hover:bg-[#EFF6FF] rounded transition-colors cursor-pointer" title="查看详情">
                        <Eye size={16} />
                      </button>
                      {order.status === 'submitted' || order.status === 'printed' ? (
                        <>
                          <button onClick={() => handleSettle(order.id)} className="p-1.5 text-[#10B981] hover:bg-[#D1FAE5] rounded transition-colors cursor-pointer" title="标记结账">
                            <CheckCircle size={16} />
                          </button>
                          <button onClick={() => openAddDish(order)} className="p-1.5 text-[#F59E0B] hover:bg-amber-50 rounded transition-colors cursor-pointer" title="加餐">
                            <PlusCircle size={16} />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs text-[#64748B]">{order.order_number}</div>
                    <button
                      onClick={() => copyOrderNumber(order.order_number)}
                      className="text-xs text-[#2563EB] hover:underline mt-0.5 flex items-center gap-1 cursor-pointer"
                    >
                      <Copy size={12} /> 复制
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 订单列表 - 平板端卡片式表格 */}
      <div className="hidden lg:block xl:hidden space-y-4">
        {orders.map((order, index) => {
          const s = statusMap[order.status] || statusMap.submitted
          const isExpanded = expandedOrders.has(order.id)
          const items = order.order_items || []
          const groupedItems = isExpanded ? groupItemsByPhase(items) : []

          return (
            <>
              <div key={order.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {/* 主信息栏 */}
                <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-4">
                    {/* 桌号 */}
                    <div className="text-center">
                      <div className="text-2xl font-bold text-[#0F172A]">{order.tables?.table_number || '-'}</div>
                      <div className="text-xs text-[#94A3B8]">桌</div>
                    </div>
                    
                    {/* 订单信息 */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-[#334155]">{order.order_number}</span>
                        <button
                          onClick={() => copyOrderNumber(order.order_number)}
                          className="p-1 text-[#94A3B8] hover:text-[#2563EB] cursor-pointer"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                      <div className="text-xs text-[#94A3B8]">{formatFullDateTime(order.created_at)}</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    {/* 金额 */}
                    <div className="text-right">
                      <div className="text-xl font-bold text-[#2563EB]">¥{order.total_amount}</div>
                    </div>
                    
                    {/* 状态 */}
                    <span className={`text-xs font-medium px-3 py-1.5 rounded-full ${s.color}`}>{s.label}</span>
                  </div>
                </div>

                {/* 菜品摘要/明细 */}
                <div className="border-t border-gray-100">
                  {!isExpanded ? (
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div className="text-sm text-[#64748B]">
                        {items.length > 0
                          ? items.map(i => `${i.dish_name}×${i.quantity}`).join('、')
                          : '无菜品'}
                      </div>
                      <button
                        onClick={() => toggleExpand(order.id)}
                        className="text-sm text-[#2563EB] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <ChevronDown size={14} />
                        展开明细 ({items.length}道)
                      </button>
                    </div>
                  ) : (
                    <div className="px-4 pb-4 pt-3">
                      {groupedItems.map((group, gi) => (
                        <div key={gi} className="mb-3 last:mb-0">
                          {/* 分组标题 */}
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-sm font-semibold ${gi === 0 ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
                              {group.label}
                            </span>
                            <span className="text-xs text-[#94A3B8]">{formatDateTime(group.time)}</span>
                          </div>
                          
                          {/* 菜品列表 */}
                          <div className="bg-[#F8FAFC] rounded-lg p-3 space-y-2">
                            {group.items.map((item, ii) => (
                              <div key={ii} className="flex justify-between items-center">
                                <div className="flex-1">
                                  <span className="text-sm text-[#0F172A]">
                                    {item.dish_name}
                                    {item.spec_name && <span className="text-[#94A3B8]">({item.spec_name})</span>}
                                  </span>
                                  <span className="text-xs text-[#64748B] ml-2">×{item.quantity}</span>
                                </div>
                                <span className="text-sm font-medium text-[#0F172A] ml-4">¥{item.subtotal}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      
                      {/* 收起按钮 */}
                      <button
                        onClick={() => toggleExpand(order.id)}
                        className="w-full mt-3 py-2 bg-[#F1F5F9] text-[#64748B] rounded-lg text-sm flex items-center justify-center gap-1 hover:bg-[#E2E8F0] transition-colors cursor-pointer"
                      >
                        <ChevronUp size={14} />
                        收起明细
                      </button>
                    </div>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="px-4 pb-4 flex items-center justify-end gap-2">
                  <button onClick={() => openDetail(order)} className="px-4 py-2 bg-[#F1F5F9] text-[#64748B] rounded-lg text-sm font-medium hover:bg-[#E2E8F0] transition-colors cursor-pointer flex items-center gap-1">
                    <Eye size={14} /> 详情
                  </button>
                  {order.status === 'submitted' || order.status === 'printed' ? (
                    <>
                      <button onClick={() => handleSettle(order.id)} className="px-4 py-2 bg-[#10B981] text-white rounded-lg text-sm font-medium hover:bg-[#059669] transition-colors cursor-pointer flex items-center gap-1">
                        <CheckCircle size={14} /> 结账
                      </button>
                      <button onClick={() => openAddDish(order)} className="px-4 py-2 bg-[#F59E0B] text-white rounded-lg text-sm font-medium hover:bg-[#D97706] transition-colors cursor-pointer flex items-center gap-1">
                        <PlusCircle size={14} /> 加餐
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              {index < orders.length - 1 ? renderCardSeparator(`tablet-separator-${order.id}`) : null}
            </>
          )
        })}
      </div>

      {/* 订单列表 - 移动端卡片 */}
      <div className="lg:hidden space-y-4">
        {orders.map((order, index) => {
          const s = statusMap[order.status] || statusMap.submitted
          const isExpanded = expandedOrders.has(order.id)
          const items = order.order_items || []
          const groupedItems = isExpanded ? groupItemsByPhase(items) : []

          return (
            <>
              <div key={order.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {/* 卡片头部 */}
                <div className="p-4">
                  {/* 第一行：桌号（大字）+ 状态 */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold text-[#0F172A]">{order.tables?.table_number || '-'}</span>
                      <span className="text-sm text-[#94A3B8]">桌</span>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${s.color}`}>{s.label}</span>
                  </div>
                  
                  {/* 第二行：时间 + 点餐用户 */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-[#94A3B8]">{formatFullDateTime(order.created_at)}</span>
                    {(order.user || order.users) && (
                      <div className="flex items-center gap-1 text-xs text-[#64748B]">
                        <User size={12} />
                        <span>{(order.user || order.users)?.nickname || (order.user || order.users)?.username || '未知用户'}</span>
                      </div>
                    )}
                  </div>

                  {/* 收起/展开按钮 */}
                  <button
                    onClick={() => toggleExpand(order.id)}
                    className="w-full py-2 bg-[#F8FAFC] text-[#64748B] rounded-lg text-sm flex items-center justify-center gap-1 hover:bg-[#E2E8F0] transition-colors cursor-pointer"
                  >
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    {isExpanded ? '收起菜品明细' : `展开菜品明细 (${items.length}道菜)`}
                  </button>
                </div>
                
                {/* 展开的菜品明细 */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-100 pt-4">
                    {/* 按点餐时间分组 */}
                    {groupedItems.map((group, gi) => (
                      <div key={gi} className="mb-4 last:mb-0">
                        {/* 分组标题 */}
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`text-sm font-semibold ${gi === 0 ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
                            {group.label}
                          </div>
                          <div className="flex-1 h-px bg-gray-200"></div>
                          <div className="text-xs text-[#94A3B8]">{formatDateTime(group.time)}</div>
                        </div>
                        
                        {/* 菜品列表 */}
                        <div className="bg-[#F8FAFC] rounded-lg p-3 space-y-2">
                          {group.items.map((item, ii) => (
                            <div key={ii} className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="text-base font-medium text-[#0F172A] flex items-center gap-2">
                                  <span className="truncate">{item.dish_name}</span>
                                  {item.spec_name && <span className="text-[#94A3B8] text-sm">({item.spec_name})</span>}
                                  <span className="text-[#64748B] text-sm">×{item.quantity}</span>
                                </div>
                              </div>
                              <div className="text-right ml-3">
                                <div className="text-sm font-medium text-[#0F172A]">¥{item.subtotal}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    {/* 备注 */}
                    {order.remark && (
                      <div className="mt-3 p-2 bg-[#FEF3C7] rounded-lg text-sm text-[#92400E]">
                        备注：{order.remark}
                      </div>
                    )}
                  </div>
                )}

                <div className="px-4 pb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#64748B]">总金额</span>
                    <span className="text-xl font-bold text-[#2563EB]">¥{order.total_amount}</span>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="px-4 pb-4 flex items-center gap-2">
                  <button onClick={() => openDetail(order)} className="flex-1 py-2 bg-[#F1F5F9] text-[#64748B] rounded-lg text-sm font-medium hover:bg-[#E2E8F0] transition-colors cursor-pointer flex items-center justify-center gap-1">
                    <Eye size={14} /> 详情
                  </button>
                  {order.status === 'submitted' || order.status === 'printed' ? (
                    <>
                      <button onClick={() => handleSettle(order.id)} className="flex-1 py-2 bg-[#10B981] text-white rounded-lg text-sm font-medium hover:bg-[#059669] transition-colors cursor-pointer flex items-center justify-center gap-1">
                        <CheckCircle size={14} /> 结账
                      </button>
                      <button onClick={() => openAddDish(order)} className="flex-1 py-2 bg-[#F59E0B] text-white rounded-lg text-sm font-medium hover:bg-[#D97706] transition-colors cursor-pointer flex items-center justify-center gap-1">
                        <PlusCircle size={14} /> 加餐
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              {index < orders.length - 1 ? renderCardSeparator(`mobile-separator-${order.id}`) : null}
            </>
          )
        })}
      </div>

      {/* 分页组件 */}
      {orders.length > 0 && (
        <div className="flex items-center justify-center gap-2 mt-6 px-4">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            title="上一页"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="px-3 py-1 text-sm font-medium text-[#334155]">
            第 {currentPage} 页
          </span>
          <button
            onClick={() => setCurrentPage(p => p + 1)}
            disabled={!hasMore}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            title="下一页"
          >
            <ChevronRight size={16} />
          </button>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setCurrentPage(1)
            }}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            <option value={10}>10条/页</option>
            <option value={20}>20条/页</option>
            <option value={50}>50条/页</option>
          </select>
        </div>
      )}

      {/* 订单详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 p-4 pb-0">
              <h3 className="text-base font-semibold text-[#0F172A]">订单详情</h3>
              <button onClick={() => setDetail(null)} className="text-[#94A3B8] hover:text-[#0F172A] cursor-pointer text-lg leading-none">×</button>
            </div>
            
            <div className="flex-1 overflow-auto p-4 pb-0">
              {/* 桌号和状态 */}
              <div className="bg-[#F8FAFC] rounded-lg p-3 mb-3 text-center">
                <div className="text-2xl font-bold text-[#0F172A]">{detail.tables?.table_number || '-'}桌</div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full mt-1 inline-block ${statusMap[detail.status]?.color}`}>{statusMap[detail.status]?.label}</span>
              </div>

              {/* 菜品明细 */}
              <div>
                <p className="text-xs font-medium text-[#334155] mb-2">菜品明细（按点餐类型分组）</p>
                {detail.order_items && detail.order_items.length > 0 ? (
                  <div className="space-y-2.5">
                    {groupItemsByPhase(detail.order_items).map((group, gi) => (
                      <div key={gi}>
                        {/* 分组标题 */}
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <div className={`text-xs font-semibold ${gi === 0 ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
                            {group.label}
                          </div>
                          <div className="flex-1 h-px bg-gray-200"></div>
                          <div className="text-xs text-[#94A3B8]">{formatDateTime(group.time)}</div>
                        </div>
                        
                        {/* 菜品列表 */}
                        <div className="bg-[#F8FAFC] rounded-lg p-2.5 space-y-2">
                          {group.items.map((item, ii) => (
                            <div key={ii} className="flex justify-between items-start">
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-[#0F172A] truncate">
                                  {item.dish_name}
                                  {item.spec_name && <span className="text-[#94A3B8] font-normal">({item.spec_name})</span>}
                                </div>
                                <div className="text-xs text-[#64748B] mt-0.5">¥{item.price} × {item.quantity}</div>
                                {item.added_by_nickname && (
                                  <div className="text-xs text-[#94A3B8] flex items-center gap-1 mt-0.5">
                                    <User size={9} /> {item.added_by_nickname}
                                  </div>
                                )}
                              </div>
                              <div className="text-right ml-2">
                                <div className="text-xs font-semibold text-[#0F172A]">¥{item.subtotal}</div>
                                {(detail.status === 'submitted' || detail.status === 'printed' || detail.status === 'unpaid') && (
                                  <div className="flex items-center gap-1 mt-1 justify-end">
                                    <button
                                      onClick={() => handleUpdateItemQty(detail.id, item.id, item.quantity - 1)}
                                      className="p-1 text-[#EF4444] hover:bg-red-50 rounded cursor-pointer"
                                      disabled={loading}
                                    >
                                      <Minus size={12} />
                                    </button>
                                    <button
                                      onClick={() => handleUpdateItemQty(detail.id, item.id, item.quantity + 1)}
                                      className="p-1 text-[#2563EB] hover:bg-[#EFF6FF] rounded cursor-pointer"
                                      disabled={loading}
                                    >
                                      <Plus size={12} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#94A3B8] text-center py-3">暂无菜品</p>
                )}
              </div>

              {/* 其他信息（订单号、时间、用户、备注） */}
              <div className="bg-[#F8FAFC] rounded-lg p-3 mt-3">
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">订单号</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs">{detail.order_number}</span>
                      <button onClick={() => copyOrderNumber(detail.order_number)} className="text-[#2563EB] hover:text-[#1D4ED8] cursor-pointer">
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">下单时间</span>
                    <span className="text-xs">{formatFullDateTime(detail.created_at)}</span>
                  </div>
                  {(detail.user || detail.users) && (
                    <div className="flex justify-between">
                      <span className="text-[#94A3B8]">点餐用户</span>
                      <span className="text-xs">{(detail.user || detail.users)?.nickname || (detail.user || detail.users)?.username || '未知用户'}</span>
                    </div>
                  )}
                  {detail.remark && (
                    <div className="pt-1.5 border-t border-gray-200">
                      <div className="text-[#94A3B8] text-xs mb-1">备注</div>
                      <div className="text-[#92400E] bg-[#FEF3C7] p-1.5 rounded text-xs">{detail.remark}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* 合计金额 */}
              <div className="flex justify-between items-center mt-3 pt-2.5 border-t border-[#2563EB]/30">
                <span className="text-sm font-medium text-[#334155]">合计</span>
                <span className="text-xl font-bold text-[#2563EB]">¥{detail.total_amount}</span>
              </div>
            </div>

            {/* 操作按钮（固定在底部） */}
            <div className="p-4 border-t border-gray-100 bg-white">
              <div className="flex items-center gap-2">
                <button onClick={() => setDetail(null)} className="flex-1 py-2 bg-[#F1F5F9] text-[#64748B] rounded-lg text-xs font-medium hover:bg-[#E2E8F0] transition-colors cursor-pointer">
                  关闭
                </button>
                {(detail.status === 'submitted' || detail.status === 'printed' || detail.status === 'unpaid') && (
                  <button
                    onClick={() => openAddDish(detail)}
                    className="flex-1 py-2 bg-[#F8FAFC] text-[#334155] rounded-lg text-xs font-medium hover:bg-[#F1F5F9] transition-colors cursor-pointer flex items-center justify-center gap-1"
                    disabled={loading}
                  >
                    <PlusCircle size={14} />
                    加餐
                  </button>
                )}
                {detail.status === 'submitted' || detail.status === 'printed' ? (
                  <>
                    <button onClick={() => { handleCancel(detail.id); setDetail(null) }} className="flex-1 py-2 bg-[#EF4444] text-white rounded-lg text-xs font-medium hover:bg-[#DC2626] transition-colors cursor-pointer">
                      取消订单
                    </button>
                    <button onClick={() => { handleSettle(detail.id); setDetail(null) }} className="flex-1 py-2 bg-[#10B981] text-white rounded-lg text-xs font-medium hover:bg-[#059669] transition-colors cursor-pointer">
                      确认结账
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 加餐弹窗 */}
      {addDishOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setAddDishOrder(null)}>
          <div className="bg-white rounded-3xl overflow-hidden w-full max-w-lg max-h-[70vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="text-lg font-bold text-[#0F172A]">选择菜品加餐</h3>
                <p className="text-xs text-[#94A3B8] mt-1">{addDishOrder.tables?.table_number || '-'}桌</p>
              </div>
              <button
                onClick={closeAddDishModal}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
              >
                <XCircle size={20} />
              </button>
            </div>

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
                      <div
                        key={dish.id}
                        className="flex items-center justify-between p-3 bg-white border border-[#E2E8F0] rounded-2xl"
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
                            onClick={() => updateCartItem(dish, -1)}
                            className="w-7 h-7 flex items-center justify-center bg-gray-200 text-[#334155] rounded-md hover:bg-gray-300 cursor-pointer"
                          >
                            <Minus size={14} />
                          </button>
                          <button
                            onClick={() => updateCartItem(dish, 1)}
                            className="w-7 h-7 flex items-center justify-center bg-[#2563EB] text-white rounded-md hover:bg-[#1D4ED8] cursor-pointer"
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
                  onClick={closeAddDishModal}
                  className="flex-1 py-3 bg-gray-100 text-[#334155] rounded-xl text-sm font-medium hover:bg-gray-200 cursor-pointer"
                >
                  关闭
                </button>
                <button
                  onClick={() => handleAddDish(addDishOrder.id)}
                  disabled={loading || Object.keys(addDishCart).length === 0}
                  className="flex-1 py-3 bg-[#10B981] text-white rounded-xl text-sm font-medium hover:bg-[#059669] transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <ShoppingCart size={16} />
                  {loading ? '提交中...' : `提交加餐（${getCartCount()}件）`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
