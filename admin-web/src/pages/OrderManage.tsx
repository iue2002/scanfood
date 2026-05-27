import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import request from '@/api/request'
import { CheckCircle, XCircle, Eye, Calendar, Tag, Filter, ChevronDown, ChevronUp, Copy, User, ChevronLeft, ChevronRight, Minus, Plus, PlusCircle, Printer, Search, ShoppingCart, ShoppingBag, X } from 'lucide-react'
import { useModal } from '@/components/ModalProvider'
import { useWebSocketEvent, useWebSocketReconnect } from '@/components/WebSocketProvider'
import { useUnread } from '@/components/UnreadProvider'
import { requestNotificationPermission } from '@/utils/notification'
import PrintActionModal from '@/components/PrintActionModal'

// 外带订单标识
const isTakeawayOrder = (order: { order_type?: string }) => order.order_type === 'takeaway'
const formatTakeawayLabel = (order: { pickup_no?: number | null }) => order.pickup_no ? `外带 ${order.pickup_no}号` : '外带'

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
  order_type?: string  // dine_in 堂食 / takeaway 外带
  pickup_no?: number | null
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
  const focusRef = useRef<Map<number, HTMLElement>>(new Map())
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast, showConfirm, markLocalAction } = useModal()
  const { markAllRead } = useUnread()
  const [loading, setLoading] = useState(false)
  const [dishes, setDishes] = useState<Dish[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [addDishCart, setAddDishCart] = useState<Record<number, { dish: Dish; quantity: number }>>({})
  
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [hasMore, setHasMore] = useState(true)
  // 打印操作弹窗
  const [printOrder, setPrintOrder] = useState<Order | null>(null)
  // 订单号搜索（输入框值 + 防抖后用于查询的值）
  const [orderSearchInput, setOrderSearchInput] = useState('')
  const [orderSearch, setOrderSearch] = useState('')
  // 筛选面板折叠（默认收起，点击状态筛选后展开）
  const [filterExpanded, setFilterExpanded] = useState(false)
  // 日期/时段筛选抽屉（< lg 用；桌面端直接平铺）
  const [dateDrawerOpen, setDateDrawerOpen] = useState(false)
  // 输入 300ms 后才真发请求，避免每个字符都查
  useEffect(() => {
    const t = setTimeout(() => setOrderSearch(orderSearchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [orderSearchInput])
  // 搜索条件变化时回到第 1 页（避免在第 N 页搜出 0 条但其实第 1 页有结果）
  useEffect(() => {
    setCurrentPage(1)
  }, [orderSearch])

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
    if (orderSearch) params.search = orderSearch
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
  }, [filterStatus, dateFrom, dateTo, currentPage, pageSize, orderSearch])

  useEffect(() => {
    fetchOrders()
    requestNotificationPermission()
    // 进入订单页：清零订单未读徽标
    markAllRead('orders')
  }, [fetchOrders, markAllRead])

  // 处理通知点击跳转：?focus=订单ID 时滚到该订单 + 高亮 1.5s + 清掉 query 参数
  useEffect(() => {
    const focusId = searchParams.get('focus')
    if (!focusId || orders.length === 0) return
    const id = parseInt(focusId, 10)
    if (isNaN(id)) return

    // 等下一帧让卡片渲染完
    const t = setTimeout(() => {
      const el = focusRef.current.get(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // 加临时高亮 class，1.5s 后移除
        el.classList.add('order-card-flash')
        setTimeout(() => el.classList.remove('order-card-flash'), 1800)
      }
      // 清掉 ?focus 参数（避免刷新时反复滚动）
      const next = new URLSearchParams(searchParams)
      next.delete('focus')
      setSearchParams(next, { replace: true })
    }, 100)
    return () => clearTimeout(t)
  }, [orders, searchParams, setSearchParams])

  // 数据刷新订阅；toast/桌面通知由全局 NotificationCenter 统一处理
  useWebSocketEvent('orderUpdated', fetchOrders)
  useWebSocketEvent('orderStatusChanged', fetchOrders)
  useWebSocketEvent('orderDeleted', useCallback((data: any) => {
    setOrders(prev => prev.filter(o => o.id !== data?.id))
  }, []))
  useWebSocketEvent('refundCreated', fetchOrders)
  useWebSocketEvent('refundUpdated', fetchOrders)
  // ws 断线重连后补拉一次：避免断线期间错过 orderStatusChanged 等事件造成 UI 不刷新
  useWebSocketReconnect(fetchOrders)

  const handleSettle = async (id: number) => {
    showConfirm('确认结账', '确认标记该订单为已结账？', async () => {
      await request.post(`/orders/${id}/status`, { status: 'settled' })
      markLocalAction(`order:settled:${id}`)
      fetchOrders()
      showToast('订单已结账', 'success')
    })
  }

  const handleReprint = (orderId: number) => {
    // 进入"打印操作"高定制化弹窗：默认补打 / 选方案 / 选购打印
    const order = orders.find((o) => o.id === orderId)
    if (!order) {
      showToast('订单不存在', 'error')
      return
    }
    setPrintOrder(order)
  }

  const handleCancel = async (id: number) => {
    showConfirm('确认取消', '确认取消该订单？', async () => {
      await request.post(`/orders/${id}/status`, { status: 'cancelled' })
      markLocalAction(`order:cancelled:${id}`)
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
          label: currentRound === 0 ? '' : `第${currentRound}次加餐`,
          phase: currentRound === 0 ? 'order' : 'add_more'
        })
        currentGroup = [sorted[i]]
        currentRound = sorted[i].add_more_round
      }
    }
    groups.push({
      time: currentGroup[0].created_at,
      items: currentGroup,
      label: currentRound === 0 ? '' : `第${currentRound}次加餐`,
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
      {/* 标题栏（桌面端显示，小屏隐藏 — 与 Sidebar 高亮项重复） */}
      <div className="hidden lg:flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-[#0F172A]">订单管理</h2>
      </div>

      {/* 筛选区域 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 mb-5 space-y-3">
        {/* 第 1 行：订单号搜索 + 状态切换 + 日期按钮 */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8] pointer-events-none" />
            <input
              type="text"
              value={orderSearchInput}
              onChange={(e) => setOrderSearchInput(e.target.value)}
              placeholder="按订单号搜索"
              className="w-full pl-9 pr-9 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
            {orderSearchInput && (
              <button
                type="button"
                onClick={() => setOrderSearchInput('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#EF4444] cursor-pointer"
                title="清除"
              >
                <XCircle size={16} />
              </button>
            )}
          </div>

          {/* 状态芯片（点击展开/选择后自动收起） */}
          <button
            onClick={() => setFilterExpanded(v => !v)}
            className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              filterStatus
                ? 'bg-[#2563EB] text-white'
                : 'bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]'
            }`}
          >
            <span className="max-w-[4em] truncate">
              {filterStatus
                ? [{ value: 'submitted', label: '已提交' },{ value: 'printed', label: '已打印' },{ value: 'unpaid', label: '待支付' },{ value: 'settled', label: '已结账' },{ value: 'cancelled', label: '已取消' },{ value: 'refunded', label: '已退款' },{ value: 'draft', label: '待提交' }].find(i => i.value === filterStatus)?.label
                : '全部'}
            </span>
            {filterExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          <button
            type="button"
            onClick={() => setDateDrawerOpen(true)}
            className={`lg:hidden shrink-0 inline-flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm transition-colors cursor-pointer ${
              activeTag || dateFrom || dateTo
                ? 'bg-[#EFF6FF] border-[#2563EB] text-[#2563EB]'
                : 'bg-white border-gray-200 text-[#475569] hover:bg-gray-50'
            }`}
          >
            <Calendar size={16} />
            <span>{activeTag ? presetTags.find(t => t.key === activeTag)?.label : '日期'}</span>
            {(activeTag || dateFrom || dateTo) && <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />}
          </button>
        </div>

        {/* 第 2 行：展开的状态筛选胶囊 */}
        {filterExpanded && (
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap -mx-1 px-1 pb-1">
            {[
              { value: '', label: '全部' },
              { value: 'submitted', label: '已提交' },
              { value: 'printed', label: '已打印' },
              { value: 'unpaid', label: '待支付' },
              { value: 'settled', label: '已结账' },
              { value: 'cancelled', label: '已取消' },
              { value: 'refunded', label: '已退款' },
              { value: 'draft', label: '待提交' },
            ].map((item) => (
              <button
                key={item.value || 'all'}
                onClick={() => { setFilterStatus(item.value); setFilterExpanded(false) }}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  filterStatus === item.value
                    ? 'bg-[#2563EB] text-white'
                    : 'bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {/* 第 3 / 4 行：时段 + 自定义日期（仅 lg 桌面端） */}
        <div className="hidden lg:block space-y-3">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-[#94A3B8] mb-1.5">
              <Tag size={12} />
              <span>时段</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {presetTags.map(tag => (
                <button
                  key={tag.key}
                  onClick={() => applyTag(tag.key)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    activeTag === tag.key
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]'
                  }`}
                >
                  {tag.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-[#94A3B8] mb-1.5">
              <Calendar size={12} />
              <span>自定义日期</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setActiveTag('') }}
                className="flex-1 min-w-0 px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
              <span className="text-[#94A3B8] text-sm shrink-0">至</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setActiveTag('') }}
                className="flex-1 min-w-0 px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>
          </div>
        </div>

        {/* 清除全部筛选 */}
        {(dateFrom || dateTo || filterStatus || orderSearchInput || activeTag) && (
          <div className="flex items-center justify-end pt-1 border-t border-gray-100">
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setFilterStatus(''); setActiveTag(''); setOrderSearchInput('') }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-[#EF4444] hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
            >
              <XCircle size={14} />
              清除全部筛选
            </button>
          </div>
        )}
      </div>

      {/* 日期/时段抽屉（仅 < lg 触发） */}
      {dateDrawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDateDrawerOpen(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl flex flex-col max-h-[85vh]">
            {/* 抽屉头 */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
              <h3 className="text-base font-semibold text-[#0F172A] inline-flex items-center gap-2">
                <Calendar size={18} className="text-[#2563EB]" />
                日期筛选
              </h3>
              <button
                onClick={() => setDateDrawerOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer"
                aria-label="关闭"
              >
                <X size={20} />
              </button>
            </div>

            {/* 抽屉内容 */}
            <div className="flex-1 overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4">
              {/* 时段预设 */}
              <div>
                <p className="text-xs font-medium text-[#94A3B8] mb-2">时段</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {presetTags.map(tag => (
                    <button
                      key={tag.key}
                      onClick={() => applyTag(tag.key)}
                      className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer min-h-[44px] ${
                        activeTag === tag.key
                          ? 'bg-[#2563EB] text-white'
                          : 'bg-[#F8FAFC] text-[#475569] hover:bg-[#F1F5F9]'
                      }`}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 自定义日期 */}
              <div>
                <p className="text-xs font-medium text-[#94A3B8] mb-2">自定义日期</p>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-[#94A3B8]">开始日期</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => { setDateFrom(e.target.value); setActiveTag('') }}
                      className="w-full px-3 py-2.5 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB] min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#94A3B8]">结束日期</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => { setDateTo(e.target.value); setActiveTag('') }}
                      className="w-full px-3 py-2.5 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB] min-h-[44px]"
                    />
                  </div>
                </div>
              </div>

              {/* 抽屉底部操作 */}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={() => {
                    setDateFrom('')
                    setDateTo('')
                    setActiveTag('')
                  }}
                  disabled={!dateFrom && !dateTo && !activeTag}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer min-h-[44px]"
                >
                  清除日期筛选
                </button>
                <button
                  onClick={() => setDateDrawerOpen(false)}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8] transition-colors cursor-pointer min-h-[44px]"
                >
                  完成
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                <tr
                  key={order.id}
                  ref={(el) => { if (el) focusRef.current.set(order.id, el); else focusRef.current.delete(order.id); }}
                  className="border-t border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    {isTakeawayOrder(order) ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-100 text-purple-700 text-sm font-bold border border-purple-300">
                        <ShoppingBag size={16} /> {formatTakeawayLabel(order)}
                      </span>
                    ) : (
                      <div className="text-xl font-bold text-[#2563EB]">{order.tables?.table_number || '-'}</div>
                    )}
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
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => openDetail(order)} className="inline-flex items-center justify-center w-9 h-9 text-[#2563EB] bg-[#EFF6FF] hover:bg-[#DBEAFE] rounded-lg transition-colors cursor-pointer" title="查看详情">
                        <Eye size={18} />
                      </button>
                      {order.status === 'submitted' || order.status === 'printed' ? (
                        <>
                          <button onClick={() => handleSettle(order.id)} className="inline-flex items-center justify-center w-9 h-9 text-[#10B981] bg-[#D1FAE5] hover:bg-[#A7F3D0] rounded-lg transition-colors cursor-pointer" title="标记结账">
                            <CheckCircle size={18} />
                          </button>
                          <button onClick={() => openAddDish(order)} className="inline-flex items-center justify-center w-9 h-9 text-[#F59E0B] bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors cursor-pointer" title="加餐">
                            <PlusCircle size={18} />
                          </button>
                        </>
                      ) : null}
                      <button onClick={() => handleReprint(order.id)} className="inline-flex items-center justify-center w-9 h-9 text-[#9333EA] bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors cursor-pointer" title="补打小票">
                        <Printer size={18} />
                      </button>
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
          const totalCount = items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0)
          const canSettle = order.status === 'submitted' || order.status === 'printed'

          return (
            <div
              key={order.id}
              ref={(el) => { if (el) focusRef.current.set(order.id, el); else focusRef.current.delete(order.id); }}
            >
              <div
                className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden cursor-pointer hover:border-[#2563EB]/30 hover:shadow-md transition-all"
                onClick={() => openDetail(order)}
              >
                {/* 头部：桌号 + 状态 + 时间 */}
                <div className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    {isTakeawayOrder(order) ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-100 text-purple-700 text-sm font-bold leading-none">
                        <ShoppingBag size={14} /> {formatTakeawayLabel(order)}
                      </span>
                    ) : (
                      <div className="flex items-baseline gap-1">
                        <span className="text-xl font-bold text-[#0F172A] leading-none">{order.tables?.table_number || '-'}</span>
                        <span className="text-xs text-[#94A3B8]">号桌</span>
                      </div>
                    )}
                    <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${s.color}`}>{s.label}</span>
                  </div>
                  <span className="text-xs text-[#94A3B8] shrink-0">{formatDateTime(order.created_at)}</span>
                </div>

                {/* 菜品摘要/明细 */}
                <div className="border-t border-gray-100">
                  {!isExpanded ? (
                    <div
                      onClick={(e) => { e.stopPropagation(); toggleExpand(order.id) }}
                      className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                    >
                      <span className="text-sm text-[#64748B] truncate min-w-0">
                        {items.length > 0
                          ? items.map(i => `${i.dish_name}×${i.quantity}`).join('、')
                          : '无菜品'}
                      </span>
                      <span className="shrink-0 text-sm text-[#2563EB] flex items-center gap-1">
                        共{totalCount}件
                        <ChevronDown size={14} />
                      </span>
                    </div>
                  ) : (
                    <div className="px-4 pb-4 pt-3">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          {groupedItems.map((group, gi) => (
                            <div key={gi} className="mb-3 last:mb-0">
                              {group.label ? (
                                <div className="flex items-center gap-2 mb-2">
                                  <span className={`text-sm font-semibold ${gi === 0 ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
                                    {group.label}
                                  </span>
                                  <span className="text-xs text-[#94A3B8]">{formatDateTime(group.time)}</span>
                                </div>
                              ) : null}
                              <div className="bg-[#F0F4FF] border border-[#E0E7FF] rounded-lg p-3 space-y-2">
                                {group.items.map((item, ii) => (
                                  <div key={ii} className="flex justify-between items-center">
                                    <div className="flex-1">
                                      <span className="text-sm text-[#0F172A]">
                                        {item.dish_name}
                                        {item.spec_name && <span className="text-[#94A3B8]">({item.spec_name})</span>}
                                      </span>
                                      <span className="text-xs text-[#64748B] ml-2 bidi-iso">×{item.quantity}</span>
                                    </div>
                                    <span className="text-sm font-medium text-[#0F172A] ml-4">¥{item.subtotal}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleExpand(order.id) }}
                          className="shrink-0 mt-1 text-[#CBD5E1] hover:text-[#64748B] transition-colors cursor-pointer"
                          title="收起"
                        >
                          <ChevronUp size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 底栏：合计 + 操作 */}
                <div
                  className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-lg font-bold text-[#2563EB]">¥{order.total_amount}</span>
                  <div className="flex items-center gap-1.5">
                    {canSettle ? (
                      <>
                        <button
                          onClick={() => handleSettle(order.id)}
                          className="px-3 py-2 bg-[#10B981] text-white rounded-lg text-xs font-medium hover:bg-[#059669] transition-colors flex items-center gap-1"
                        >
                          <CheckCircle size={13} /> 结账
                        </button>
                        <button
                          onClick={() => openAddDish(order)}
                          className="px-3 py-2 bg-[#F59E0B] text-white rounded-lg text-xs font-medium hover:bg-[#D97706] transition-colors flex items-center gap-1"
                        >
                          <PlusCircle size={13} /> 加餐
                        </button>
                      </>
                    ) : null}
                    {/* 已结账/取消等状态下保留一个操作入口，提示点击卡片查看详情 */}
                  </div>
                </div>
              </div>
              {index < orders.length - 1 ? renderCardSeparator(`tablet-separator-${order.id}`) : null}
            </div>
          )
        })}
      </div>

      {/* 订单列表 - 移动端卡片 */}
      <div className="lg:hidden space-y-3">
        {orders.map((order, index) => {
          const s = statusMap[order.status] || statusMap.submitted
          const isExpanded = expandedOrders.has(order.id)
          const items = order.order_items || []
          const groupedItems = isExpanded ? groupItemsByPhase(items) : []
          const summaryText = items.length > 0
            ? items.map(i => `${i.dish_name}×${i.quantity}`).join('，')
            : '无菜品'
          const totalCount = items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0)
          const canSettle = order.status === 'submitted' || order.status === 'printed'

          return (
            <div
              key={order.id}
              ref={(el) => { if (el) focusRef.current.set(order.id, el); else focusRef.current.delete(order.id); }}
            >
              <div
                className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden cursor-pointer hover:border-[#2563EB]/30 active:bg-[#FAFBFC] transition-all"
                onClick={() => openDetail(order)}
              >
                {/* 头部：桌号 + 状态 + 时间 */}
                <div className="px-4 py-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {isTakeawayOrder(order) ? (
                      <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-100 text-purple-700 text-xs font-bold leading-none">
                        <ShoppingBag size={12} /> {formatTakeawayLabel(order)}
                      </span>
                    ) : (
                      <div className="flex items-baseline gap-1 min-w-0">
                        <span className="text-xl font-bold text-[#0F172A] leading-none">{order.tables?.table_number || '-'}</span>
                        <span className="text-[11px] text-[#94A3B8]">号桌</span>
                      </div>
                    )}
                    <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${s.color}`}>{s.label}</span>
                  </div>
                  <span className="text-[11px] text-[#94A3B8] shrink-0">{formatDateTime(order.created_at)}</span>
                </div>

                {/* 单行菜品摘要（阻止冒泡） */}
                {!isExpanded && (
                  <div
                    onClick={(e) => { e.stopPropagation(); toggleExpand(order.id) }}
                    className="px-4 pb-3 flex items-center justify-between gap-2 cursor-pointer hover:bg-[#F8FAFC] transition-colors"
                  >
                    <span className="flex-1 min-w-0 truncate text-xs text-[#64748B]">{summaryText}</span>
                    <span className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-[#94A3B8]">
                      共{totalCount}件
                      <ChevronDown size={12} className="text-[#CBD5E1]" />
                    </span>
                  </div>
                )}

                {/* 展开的明细 */}
                {isExpanded && (
                  <div className="px-4 py-3 border-t border-gray-100">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        {groupedItems.map((group, gi) => (
                          <div key={gi} className="mb-3 last:mb-0">
                            {group.label ? (
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className={`text-xs font-semibold ${gi === 0 ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
                                  {group.label}
                                </span>
                                <div className="flex-1 h-px bg-gray-200"></div>
                                <span className="text-[11px] text-[#94A3B8]">{formatDateTime(group.time)}</span>
                              </div>
                            ) : null}
                            <div className="bg-[#F0F4FF] border border-[#E0E7FF] rounded-lg px-3 py-2 space-y-1.5">
                              {group.items.map((item, ii) => (
                                <div key={ii} className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0 text-sm text-[#0F172A] leading-snug">
                                    <span className="truncate">{item.dish_name}</span>
                                    {item.spec_name && <span className="text-[#94A3B8] text-xs ml-1">({item.spec_name})</span>}
                                    <span className="text-[#64748B] text-xs ml-1 bidi-iso">×{item.quantity}</span>
                                  </div>
                                  <span className="shrink-0 text-xs font-medium text-[#0F172A] bidi-iso">¥{item.subtotal}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                        {order.remark && (
                          <div className="mt-2 p-2 bg-[#FEF3C7] rounded-lg text-xs text-[#92400E]">
                            备注：{order.remark}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleExpand(order.id) }}
                        className="shrink-0 mt-1 text-[#CBD5E1] hover:text-[#64748B] cursor-pointer"
                        title="收起"
                      >
                        <ChevronUp size={15} />
                      </button>
                    </div>
                  </div>
                )}

                {/* 底栏：合计 + 操作（阻止冒泡） */}
                <div
                  className="px-4 py-2.5 border-t border-gray-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="flex items-baseline gap-1 mr-auto">
                      <span className="text-[11px] text-[#94A3B8]">合计</span>
                      <span className="text-base font-bold text-[#2563EB] leading-none">¥{order.total_amount}</span>
                    </div>
                    {canSettle ? (
                      <>
                        <button
                          onClick={() => handleSettle(order.id)}
                          className="h-7 px-2.5 bg-[#10B981] text-white rounded-lg text-[11px] font-medium hover:bg-[#059669] transition-colors flex items-center gap-0.5"
                        >
                          <CheckCircle size={11} /> 结账
                        </button>
                        <button
                          onClick={() => openAddDish(order)}
                          className="h-7 px-2.5 bg-[#F59E0B] text-white rounded-lg text-[11px] font-medium hover:bg-[#D97706] transition-colors flex items-center gap-0.5"
                        >
                          <PlusCircle size={11} /> 加餐
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              {index < orders.length - 1 ? renderCardSeparator(`mobile-separator-${order.id}`) : null}
            </div>
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
                {isTakeawayOrder(detail) ? (
                  <div className="text-3xl font-bold text-purple-600 flex items-center justify-center gap-2 py-1">
                    <ShoppingBag size={28} /> {formatTakeawayLabel(detail)}
                  </div>
                ) : (
                  <div className="text-2xl font-bold text-[#0F172A]">{detail.tables?.table_number || '-'}桌</div>
                )}
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full mt-1 inline-block ${statusMap[detail.status]?.color}`}>{statusMap[detail.status]?.label}</span>
              </div>

              {/* 菜品明细 */}
              <div>
                <p className="text-xs font-medium text-[#334155] mb-2">菜品明细（按点餐类型分组）</p>
                {detail.order_items && detail.order_items.length > 0 ? (
                  <div className="space-y-2.5">
                    {groupItemsByPhase(detail.order_items).map((group, gi) => (
                      <div key={gi}>
                        {/* 分组标题（仅加餐轮次显示） */}
                        {group.label ? (
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <div className={`text-xs font-semibold ${gi === 0 ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
                              {group.label}
                            </div>
                            <div className="flex-1 h-px bg-gray-200"></div>
                            <div className="text-xs text-[#94A3B8]">{formatDateTime(group.time)}</div>
                          </div>
                        ) : null}
                        
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
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setDetail(null)} className="flex-1 min-w-[80px] py-2.5 bg-[#F1F5F9] text-[#64748B] rounded-lg text-xs font-medium hover:bg-[#E2E8F0] transition-colors cursor-pointer min-h-[40px]">
                  关闭
                </button>
                <button
                  onClick={() => { handleReprint(detail.id); setDetail(null) }}
                  className="flex-1 min-w-[80px] py-2.5 bg-purple-50 text-[#9333EA] rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors cursor-pointer flex items-center justify-center gap-1 min-h-[40px]"
                >
                  <Printer size={14} /> 打印
                </button>
                {(detail.status === 'submitted' || detail.status === 'printed' || detail.status === 'unpaid') && (
                  <button
                    onClick={() => openAddDish(detail)}
                    className="flex-1 min-w-[80px] py-2.5 bg-[#F8FAFC] text-[#334155] rounded-lg text-xs font-medium hover:bg-[#F1F5F9] transition-colors cursor-pointer flex items-center justify-center gap-1 min-h-[40px]"
                    disabled={loading}
                  >
                    <PlusCircle size={14} />
                    加餐
                  </button>
                )}
                {detail.status === 'submitted' || detail.status === 'printed' ? (
                  <>
                    {/* 取消订单是危险操作：在小屏单独占一行避免误触确认结账 */}
                    <button onClick={() => { handleCancel(detail.id); setDetail(null) }} className="basis-full sm:basis-auto sm:flex-1 sm:min-w-[80px] py-2.5 bg-[#EF4444] text-white rounded-lg text-xs font-medium hover:bg-[#DC2626] transition-colors cursor-pointer min-h-[40px] order-3 sm:order-none">
                      取消订单
                    </button>
                    <button onClick={() => { handleSettle(detail.id); setDetail(null) }} className="flex-1 min-w-[80px] py-2.5 bg-[#10B981] text-white rounded-lg text-xs font-medium hover:bg-[#059669] transition-colors cursor-pointer min-h-[40px]">
                      确认结账
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 打印操作弹窗 */}
      {printOrder && (
        <PrintActionModal
          order={{
            id: printOrder.id,
            order_number: printOrder.order_number,
            order_type: printOrder.order_type,
            order_items: printOrder.order_items?.map((it) => ({
              id: it.id,
              dish_name: it.dish_name,
              spec_name: it.spec_name,
              quantity: it.quantity,
              subtotal: it.subtotal,
            })),
          }}
          onClose={() => setPrintOrder(null)}
        />
      )}

      {/* 加餐弹窗 */}
      {addDishOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setAddDishOrder(null)}>
          <div className="bg-white rounded-3xl overflow-hidden w-full max-w-lg max-h-[90vh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
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
