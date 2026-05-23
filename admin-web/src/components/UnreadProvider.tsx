import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useWebSocketEvent } from './WebSocketProvider'

/**
 * 未读消息全局状态
 * - orders：新订单（status=submitted 推送）
 * - refunds：新退款申请
 * 用 Set<id> 存"已被推送进来但还没读"的项，避免重复计数。
 * 进入对应页面（OrderManage / RefundManage）时调用 markAllRead 清零。
 */
type UnreadCategory = 'orders' | 'refunds'

interface UnreadCtx {
  ordersUnread: number
  refundsUnread: number
  markAllRead: (category: UnreadCategory) => void
}

const UnreadContext = createContext<UnreadCtx | null>(null)

const STORAGE_KEY = 'admin_unread_state_v1'

function loadFromStorage(): { orders: Set<number>; refunds: Set<number> } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { orders: new Set(), refunds: new Set() }
    const parsed = JSON.parse(raw) as { orders: number[]; refunds: number[] }
    return {
      orders: new Set(parsed.orders || []),
      refunds: new Set(parsed.refunds || []),
    }
  } catch {
    return { orders: new Set(), refunds: new Set() }
  }
}

function saveToStorage(orders: Set<number>, refunds: Set<number>) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ orders: Array.from(orders), refunds: Array.from(refunds) })
    )
  } catch {
    /* localStorage 满 / 禁用 → 静默 */
  }
}

export function UnreadProvider({ children }: { children: React.ReactNode }) {
  // 初始从 localStorage 恢复，刷新页面/重新打开浏览器仍保留未读
  const [orderIds, setOrderIds] = useState<Set<number>>(() => loadFromStorage().orders)
  const [refundIds, setRefundIds] = useState<Set<number>>(() => loadFromStorage().refunds)

  // 持久化
  useEffect(() => {
    saveToStorage(orderIds, refundIds)
  }, [orderIds, refundIds])

  // 用 ref 拿到最新 set，避免 ws handler 闭包陈旧
  const orderIdsRef = useRef(orderIds)
  const refundIdsRef = useRef(refundIds)
  orderIdsRef.current = orderIds
  refundIdsRef.current = refundIds

  // 新订单推送 → 加入未读
  useWebSocketEvent(
    'orderStatusChanged',
    useCallback((data: any) => {
      if (!data || !data.id) return
      // 仅"新订单"算未读（status=submitted），其他状态变更（已结账/已取消）不算
      if (data.status !== 'submitted') return
      setOrderIds((prev) => {
        if (prev.has(data.id)) return prev
        const next = new Set(prev)
        next.add(data.id)
        return next
      })
    }, [])
  )

  // 退款申请推送 → 加入未读
  useWebSocketEvent(
    'refundCreated',
    useCallback((data: any) => {
      if (!data || !data.id) return
      setRefundIds((prev) => {
        if (prev.has(data.id)) return prev
        const next = new Set(prev)
        next.add(data.id)
        return next
      })
    }, [])
  )

  const markAllRead = useCallback((category: UnreadCategory) => {
    if (category === 'orders') {
      setOrderIds((prev) => (prev.size === 0 ? prev : new Set()))
    } else {
      setRefundIds((prev) => (prev.size === 0 ? prev : new Set()))
    }
  }, [])

  // 同步浏览器 title：有未读时加 (N) 前缀，方便用户在标签栏看到
  useEffect(() => {
    const total = orderIds.size + refundIds.size
    const baseTitle = '扫码点餐管理系统'
    document.title = total > 0 ? `(${total > 99 ? '99+' : total}) ${baseTitle}` : baseTitle
  }, [orderIds, refundIds])

  const value = useMemo<UnreadCtx>(
    () => ({
      ordersUnread: orderIds.size,
      refundsUnread: refundIds.size,
      markAllRead,
    }),
    [orderIds, refundIds, markAllRead]
  )

  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>
}

export function useUnread() {
  const ctx = useContext(UnreadContext)
  if (!ctx) throw new Error('useUnread must be used inside <UnreadProvider>')
  return ctx
}
