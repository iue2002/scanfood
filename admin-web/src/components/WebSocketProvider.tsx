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
  /**
   * 监听 ws 重连成功事件（不是首连）。页面用它在断线重连后补拉数据，
   * 避免断线期间错过的 orderStatusChanged / orderUpdated 等事件造成 UI 不刷新
   */
  onReconnect: (handler: () => void) => () => void
}

const WebSocketContext = createContext<WebSocketCtx | null>(null)

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const handlersRef = useRef<Map<string, Set<Handler>>>(new Map())
  const reconnectHandlersRef = useRef<Set<() => void>>(new Set())
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

  const onReconnect = useCallback<WebSocketCtx['onReconnect']>((handler) => {
    reconnectHandlersRef.current.add(handler)
    return () => {
      reconnectHandlersRef.current.delete(handler)
    }
  }, [])

  useEffect(() => {
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    let reconnectDelay = 1000
    // 第一次连接成功不算"重连"；之后再连成功才触发 onReconnect 回调
    let hasConnectedOnce = false
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

    const startHeartbeat = () => {
      // 心跳：每 25 秒主动发 application-level ping，让中间反代/穿透不要切连接
      // 25s 是经验值：cpolar / nginx / cloudflare 默认空闲超时通常 ≥ 60s，留 2x 余量
      stopHeartbeat()
      heartbeatTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ event: 'ping', data: { ts: Date.now() } }))
          } catch (e) {
            /* noop */
          }
        }
      }, 25_000)
    }
    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
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
      //   - DEV 环境下若 Vite proxy 不稳定，直接用 localhost:3000 直连后端
      // 关键：避免在 https 页面下用 ws:// 明文协议，浏览器会立即关闭连接
      const apiBase = import.meta.env.VITE_API_BASE_URL
      const pageIsHttps = window.location.protocol === 'https:'
      const baseIsInsecure = apiBase && /^http:\/\//i.test(apiBase)
      const isDev = import.meta.env.DEV
      const useRelative = !apiBase || (pageIsHttps && baseIsInsecure)
      let wsURL: string
      if (isDev && !apiBase) {
        // dev 且未配置 API base：直连后端 3000 端口，绕过 Vite proxy（更稳定）
        wsURL = `ws://localhost:3000/ws?token=${token}`
      } else if (useRelative) {
        wsURL = `${pageIsHttps ? 'wss:' : 'ws:'}//${window.location.host}/ws?token=${token}`
      } else {
        wsURL = apiBase!.replace(/^http/, 'ws').replace(/^https/, 'wss').replace(/\/api$/, '') +
          `/ws?token=${token}`
      }

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
        startHeartbeat()

        // 重连成功（非首连）：触发所有 reconnectHandlers 让页面补拉数据
        // 关键：避免 ws 断线期间错过 orderStatusChanged / orderUpdated 事件
        if (hasConnectedOnce) {
          reconnectHandlersRef.current.forEach((h) => {
            try { h() } catch (e) { console.error('[WS] reconnect handler error', e) }
          })
        }
        hasConnectedOnce = true
      }

      ws.onmessage = (event) => {
        if (cancelled) return
        try {
          const message = JSON.parse(event.data)
          // 内部事件直接吞掉
          if (message.event === 'subscribed' || message.event === 'pong') return
          dispatch(message.event, message.data)
        } catch (e) {
          console.error('WS message parse error', e)
        }
      }

      ws.onclose = (event) => {
        setConnected(false)
        stopHeartbeat()
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
      stopHeartbeat()
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
    <WebSocketContext.Provider value={{ connected, subscribe, onReconnect }}>
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

/**
 * 监听 ws 重连事件（不是首连）
 * 用法：useWebSocketReconnect(() => fetchOrders())
 * 关键作用：ws 断线期间错过的消息（比如商家结账时连接刚好断了），重连后用这个 hook 主动补拉一次
 */
export function useWebSocketReconnect(handler: () => void) {
  const ctx = useContext(WebSocketContext)
  if (!ctx) {
    throw new Error('useWebSocketReconnect must be used inside <WebSocketProvider>')
  }

  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const stable = () => handlerRef.current()
    return ctx.onReconnect(stable)
  }, [ctx])
}

export function useWebSocketStatus() {
  const ctx = useContext(WebSocketContext)
  if (!ctx) {
    throw new Error('useWebSocketStatus must be used inside <WebSocketProvider>')
  }
  return ctx.connected
}
