// 全局权限状态，只请求一次
let permissionGranted: boolean | null = null

/**
 * 请求浏览器通知权限。
 * 整个会话生命周期只弹一次授权框，之后走缓存。
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (permissionGranted !== null) return permissionGranted

  if (Notification.permission === 'granted') {
    permissionGranted = true
    return true
  }

  if (Notification.permission === 'denied') {
    permissionGranted = false
    return false
  }

  const result = await Notification.requestPermission()
  permissionGranted = result === 'granted'
  return permissionGranted
}

/**
 * 发送系统通知（通知栏/锁屏）
 * 仅在权限已授予时生效。
 */
export function showNotification(title: string, options?: NotificationOptions & { onClick?: () => void }) {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  try {
    const { onClick, ...rest } = options || {}
    const notification = new Notification(title, {
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      tag: String(Date.now()), // 每条独立，不做去重
      ...rest,
    })

    notification.onclick = () => {
      window.focus()
      notification.close()
      onClick?.()
    }
  } catch {
    // 忽略通知失败（如非 HTTPS 环境下）
  }
}