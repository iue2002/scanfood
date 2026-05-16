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

    const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'
    const wsURL = baseURL.replace('http', 'ws').replace('https', 'wss').replace('/api', '') + '/ws'

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

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
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
