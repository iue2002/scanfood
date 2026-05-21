import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'

/**
 * 全局唯一 WebSocket Provider
 * - 整个应用只维护一条连接，避免页面级重复订阅导致同一事件被多次 toast
 * - 提供 subscribe(event, handler) 给各个页面订阅
 * - 自动重连，失败 4001（认证失败）不重连
 */

type Handler = (data: any) => void

interface WebSocketCtx {
  connected: boolean
  subscribe: (event: string, handler: Handler) => () => void
}

const WebSocketContext = createContext<WebSocketCtx | null>(null)

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<Map<string, Set<Handler>>>(new Map())
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [connected, setConnected] = useState(false)

  const connect = useCallback(() => {
    // 幂等：已有连接就不重复创建（StrictMode 双挂载也能复用）
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    const token = localStorage.getItem('admin_token')
    if (!token) {
      reconnectTimerRef.current = setTimeout(connect, 3000)
      return
    }

    const apiBase = import.meta.env.VITE_API_BASE_URL
    const wsURL = apiBase
      ? apiBase.replace(/^http/, 'ws').replace(/^https/, 'wss').replace(/\/api$/, '') +
        `/ws?token=${token}`
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws?token=${token}`

    const ws = new WebSocket(wsURL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      ws.send(JSON.stringify({ event: 'subscribeAdmin' }))
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        if (message.event === 'subscribed') return
        const handlers = handlersRef.current.get(message.event)
        if (handlers) {
          handlers.forEach((h) => {
            try {
              h(message.data)
            } catch (e) {
              console.error('WS handler error', e)
            }
          })
        }
      } catch (e) {
        console.error('WS message parse error', e)
      }
    }

    ws.onclose = (event) => {
      setConnected(false)
      wsRef.current = null
      if (event.code === 4001) {
        console.warn('WebSocket 认证失败，停止重连')
        return
      }
      reconnectTimerRef.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      try {
        ws.close()
      } catch (e) {
        /* noop */
      }
    }
  }, [])

  const subscribe = useCallback<WebSocketCtx['subscribe']>((event, handler) => {
    let set = handlersRef.current.get(event)
    if (!set) {
      set = new Set()
      handlersRef.current.set(event, set)
    }
    set.add(handler)
    return () => {
      handlersRef.current.get(event)?.delete(handler)
    }
  }, [])

  useEffect(() => {
    connect()
    // 注意：Provider 一直存在于应用顶层，cleanup 实际只在页面卸载时触发；
    // StrictMode 双挂载场景下 connect 是幂等的，第二次 mount 不会创建第二条连接。
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      const ws = wsRef.current
      if (ws) {
        wsRef.current = null
        try {
          ws.close()
        } catch (e) {
          /* noop */
        }
      }
    }
  }, [connect])

  return (
    <WebSocketContext.Provider value={{ connected, subscribe }}>
      {children}
    </WebSocketContext.Provider>
  )
}

/**
 * 订阅单个事件的便捷 hook
 * 用法：useWebSocketEvent('orderStatusChanged', (data) => fetchOrders())
 * - handler 用 ref 透传，依赖只是 event 名，不会因 closure 变化反复重订阅
 */
export function useWebSocketEvent(event: string, handler: Handler) {
  const ctx = useContext(WebSocketContext)
  if (!ctx) {
    throw new Error('useWebSocketEvent must be used inside <WebSocketProvider>')
  }

  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const stable: Handler = (data) => handlerRef.current(data)
    return ctx.subscribe(event, stable)
  }, [ctx, event])
}

export function useWebSocketStatus() {
  const ctx = useContext(WebSocketContext)
  if (!ctx) {
    throw new Error('useWebSocketStatus must be used inside <WebSocketProvider>')
  }
  return ctx.connected
}
