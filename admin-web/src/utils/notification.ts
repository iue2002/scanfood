/**
 * 桌面通知工具
 *
 * 兼容三种环境：
 *   1. 普通浏览器 tab → new Notification(...)
 *   2. 已安装的 PWA（standalone） → 优先 ServiceWorkerRegistration.showNotification(...)
 *      （Chrome/Edge 桌面 PWA、Android Chrome 都强制要求走 SW 路径，否则弹不出来）
 *   3. iOS Safari → 通知 API 不支持，静默跳过
 *
 * 设计原则：
 *   - 权限请求只发一次（缓存到 module-level）
 *   - 通知失败永远不抛错，不影响 toast 等其他通知通道
 *   - 兜底：SW 路径失败时尝试普通 Notification
 */

let permissionGranted: boolean | null = null
let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null

/**
 * 拿到当前的 ServiceWorker 注册（vite-plugin-pwa 已经注册过 sw）
 * 缓存 promise 避免重复请求
 */
function getSWRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (swRegistrationPromise) return swRegistrationPromise
  swRegistrationPromise = (async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
    try {
      // ready 会在 sw 进入 activated 状态后 resolve
      const reg = await navigator.serviceWorker.ready
      return reg || null
    } catch {
      return null
    }
  })()
  return swRegistrationPromise
}

/**
 * 检测是否运行在 PWA standalone 模式（被安装到桌面/主屏后启动）
 */
export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false
  // iOS Safari
  if ((window.navigator as any).standalone === true) return true
  // 其他浏览器
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true
  if (window.matchMedia && window.matchMedia('(display-mode: window-controls-overlay)').matches) return true
  return false
}

/**
 * 请求浏览器通知权限。
 * 整个会话生命周期只弹一次授权框，之后走缓存。
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    console.warn('[notification] Notification API not supported in this environment')
    return false
  }
  if (permissionGranted !== null) return permissionGranted

  if (Notification.permission === 'granted') {
    permissionGranted = true
    console.log('[notification] permission already granted')
    // 顺便预热 SW registration，让 PWA 模式下首条通知就能成功
    void getSWRegistration()
    return true
  }

  if (Notification.permission === 'denied') {
    permissionGranted = false
    console.warn('[notification] permission denied (user previously rejected)')
    return false
  }

  console.log('[notification] requesting permission...')
  const result = await Notification.requestPermission()
  permissionGranted = result === 'granted'
  console.log('[notification] permission request result:', result)
  if (permissionGranted) {
    void getSWRegistration()
  }
  return permissionGranted
}

interface ShowNotificationOptions extends NotificationOptions {
  onClick?: () => void
}

/**
 * 发送系统通知（通知栏/锁屏）
 * 仅在权限已授予时生效。
 * PWA 模式下走 ServiceWorker 路径以兼容更多浏览器。
 */
export async function showNotification(title: string, options?: ShowNotificationOptions) {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    console.warn('[notification] showNotification: API not available')
    return
  }
  if (Notification.permission !== 'granted') {
    console.warn('[notification] showNotification skipped: permission =', Notification.permission)
    return
  }

  const { onClick, ...rest } = options || {}
  const notificationOptions: NotificationOptions = {
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    tag: String(Date.now()), // 每条独立，不做去重
    ...rest,
  }

  // 优先走 ServiceWorker 路径（PWA 必需，普通浏览器 tab 也兼容）
  // 失败时回退到 new Notification
  try {
    const reg = await getSWRegistration()
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, notificationOptions)
      console.log('[notification] shown via SW:', title)
      // SW 路径不支持 onclick 直接绑定，需要通过 notificationclick 事件转发
      // 这里简化处理：onClick 仅在普通 Notification 路径生效（一般场景够用）
      return
    }
    console.log('[notification] no SW available, using legacy Notification API')
  } catch (err) {
    // SW 路径失败时（少见），尝试普通路径
    console.warn('[notification] SW path failed, falling back to legacy:', err)
  }

  // 回退路径：普通浏览器 tab（非 PWA），或 SW 不可用
  try {
    const notification = new Notification(title, notificationOptions)
    notification.onclick = () => {
      window.focus()
      notification.close()
      onClick?.()
    }
    console.log('[notification] shown via legacy:', title)
  } catch (err) {
    // 忽略通知失败（如非 HTTPS 环境下）
    console.warn('[notification] legacy Notification failed:', err)
  }
}
