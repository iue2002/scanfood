import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * 监听 ServiceWorker 发来的 NOTIFICATION_CLICK 消息
 *
 * 用户点击桌面/锁屏通知 → SW 的 notificationclick 事件触发 → SW 调 client.focus() +
 * postMessage({ type: 'NOTIFICATION_CLICK', url }) → 这里收到 → react-router navigate。
 *
 * 这是 YouTube/Twitter/Discord 标准方案：让通知像 native app 推送一样可点击跳转。
 */
export default function NotificationClickHandler() {
  const navigate = useNavigate()

  useEffect(() => {
    if (typeof window === 'undefined') return

    const tryNavigate = (url: string) => {
      try {
        if (url.startsWith('/')) {
          navigate(url)
        } else {
          const u = new URL(url, window.location.origin)
          if (u.origin === window.location.origin) {
            navigate(u.pathname + u.search + u.hash)
          }
        }
      } catch {
        // malformed url，忽略
      }
    }

    // 路径 1：SW postMessage（手机锁屏 / 后台 / PWA 场景，notificationclick 触发）
    const onSWMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || data.type !== 'NOTIFICATION_CLICK') return
      const url: string = data.url || '/'
      tryNavigate(url)
    }

    // 路径 2：legacy Notification onclick（前台 tab 场景）
    const onLegacyClick = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!detail || !detail.url) return
      tryNavigate(detail.url)
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onSWMessage)
    }
    window.addEventListener('app:notification-click', onLegacyClick as EventListener)

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onSWMessage)
      }
      window.removeEventListener('app:notification-click', onLegacyClick as EventListener)
    }
  }, [navigate])

  return null
}
