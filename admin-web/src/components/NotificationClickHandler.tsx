import { useEffect } from 'react'

/**
 * 监听 ServiceWorker 发来的 NOTIFICATION_CLICK 消息
 *
 * 用户点击桌面/锁屏通知 → SW 的 notificationclick 事件触发 → SW 调 client.focus() +
 * postMessage({ type: 'NOTIFICATION_CLICK', url }) → 这里收到 → 跳转。
 *
 * 用 window.location.href 而非 react-router navigate，避免
 * useNavigate 在 PWA standalone 下某些边缘情况失效导致白屏。
 */
export default function NotificationClickHandler() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const go = (url: string) => {
      try {
        if (url.startsWith('/')) {
          // 绝对路径直接替换，避免累积
          window.location.href = url
        } else {
          const u = new URL(url, window.location.origin)
          if (u.origin === window.location.origin) {
            window.location.href = u.pathname + u.search + u.hash
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
      go(url)
    }

    // 路径 2：legacy Notification onclick（前台 tab 场景）
    const onLegacyClick = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!detail || !detail.url) return
      go(detail.url)
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
  }, [])

  return null
}
