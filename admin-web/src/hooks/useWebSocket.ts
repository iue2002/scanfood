import { useEffect, useRef, useCallback, useState } from 'react'

interface UseWebSocketOptions {
  onMessage: (event: string, data: any) => void
  autoReconnect?: boolean
  reconnectInterval?: number
}

export function useWebSocket(options: UseWebSocketOptions) {
  const { onMessage, autoReconnect = true, reconnectInterval = 3000 } = options
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const token = localStorage.getItem('admin_token')
    if (!token) {
      // 未登录，3 秒后重试
      reconnectTimerRef.current = setTimeout(connect, reconnectInterval)
      return
    }

    // 同源 WebSocket：避免 HTTPS 页面被浏览器拦截明文 ws:// 连接
    // 开发环境通过 Vite proxy (/ws) 转发到后端
    // 生产环境通过 Nginx 反向代理 /ws
    const apiBase = import.meta.env.VITE_API_BASE_URL
    const wsURL = apiBase
      ? apiBase.replace('http', 'ws').replace('https', 'wss').replace(/\/api$/, '') + `/ws?token=${token}`
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
        onMessageRef.current(message.event, message.data)
      } catch (e) {
        console.error('WebSocket message parse error:', e)
      }
    }

    ws.onclose = (event) => {
      setConnected(false)
      wsRef.current = null
      // 如果是认证失败，不再重连
      if (event.code === 4001) {
        console.warn('WebSocket 认证失败，停止重连。请重新登录。')
        return
      }
      if (autoReconnect) {
        reconnectTimerRef.current = setTimeout(connect, reconnectInterval)
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [autoReconnect, reconnectInterval])

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setConnected(false)
  }, [])

  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return { connected, reconnect: connect, disconnect }
}
