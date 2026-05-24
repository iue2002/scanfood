import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'

/**
 * 全局唯一 WebSocket Provider
 * - 整个应用维护单条连接，避免页面级重复订阅导致同一事件被多次 toast
 * - 提供 subscribe(event, handler) 给各页面按事件名订阅
 * - 自动重连（指数退避），4001 认证失败不重连
 * - StrictMode 双挂载安全：cleanup 关闭 ws 时同步取消自动重连，避免孤儿连接
 */

type Handler = (data: any) => void

interface WebSocketCtx {
  connected: boolean
  subscribe: (event: string, handler: Handler) => () => void
}

const WebSocketContext = createContext<WebSocketCtx | null>(null)

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const handlersRef = useRef<Map<string, Set<Handler>>>(new Map())
  const [connected, setConnected] = useState(false)

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
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectDelay = 1000
    // 一旦 cleanup 设为 true，所有 onclose / onerror 都不再触发重连
    let cancelled = false

    const dispatch = (event: string, data: any) => {
      const handlers = handlersRef.current.get(event)
      if (!handlers) return
      handlers.forEach((h) => {
        try {
          h(data)
        } catch (e) {
          console.error('WS handler error', e)
        }
      })
    }

    const connect = () => {
      if (cancelled) return

      const token = localStorage.getItem('admin_token')
      if (!token) {
        // 未登录：3 秒后重试（仍受 cancelled 控制）
        reconnectTimer = setTimeout(connect, 3000)
        return
      }

      // 选择 WS URL 策略：
      //   - 优先用相对路径 /ws（让 vite proxy 在 dev 转发到后端，prod 由反代处理）
      //   - 仅当显式配置了同协议的 VITE_API_BASE_URL 时才用绝对路径
      // 关键：避免在 https 页面下用 ws:// 明文协议，浏览器会立即关闭连接
      const apiBase = import.meta.env.VITE_API_BASE_URL
      const pageIsHttps = window.location.protocol === 'https:'
      const baseIsInsecure = apiBase && /^http:\/\//i.test(apiBase)
      const useRelative = !apiBase || (pageIsHttps && baseIsInsecure)
      const wsURL = useRelative
        ? `${pageIsHttps ? 'wss:' : 'ws:'}//${window.location.host}/ws?token=${token}`
        : apiBase!.replace(/^http/, 'ws').replace(/^https/, 'wss').replace(/\/api$/, '') +
          `/ws?token=${token}`

      try {
        ws = new WebSocket(wsURL)
      } catch (e) {
        console.error('[WS] new WebSocket failed', e)
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, reconnectDelay)
          reconnectDelay = Math.min(reconnectDelay * 2, 30000)
        }
        return
      }

      ws.onopen = () => {
        if (cancelled) {
          try {
            ws?.close()
          } catch (e) {
            /* noop */
          }
          return
        }
        setConnected(true)
        reconnectDelay = 1000
        try {
          ws?.send(JSON.stringify({ event: 'subscribeAdmin' }))
        } catch (e) {
          /* noop */
        }
      }

      ws.onmessage = (event) => {
        if (cancelled) return
        try {
          const message = JSON.parse(event.data)
          if (message.event === 'subscribed') return
          dispatch(message.event, message.data)
        } catch (e) {
          console.error('WS message parse error', e)
        }
      }

      ws.onclose = (event) => {
        setConnected(false)
        ws = null
        if (cancelled) return
        if (event.code === 4001) {
          console.warn('WebSocket 认证失败，停止重连')
          return
        }
        const delay = reconnectDelay
        reconnectDelay = Math.min(reconnectDelay * 2, 30000)
        reconnectTimer = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        // 让浏览器进入 close 流程，由 onclose 统一处理
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (ws) {
        try {
          ws.close(1000, 'provider unmount')
        } catch (e) {
          /* noop */
        }
        ws = null
      }
    }
  }, [])

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
