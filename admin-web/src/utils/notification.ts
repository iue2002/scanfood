/**
 * 桌面通知工具
 *
 * 设计原则（参考 YouTube/Twitter/Discord 等大型 SaaS 的实战经验）：
 *   - tab 打开时收 WebSocket 推送 → 直接用 `new Notification(...)` 是最稳的（不需要 SW）
 *   - SW 路径主要给 Web Push API（关闭 tab 后从服务端 push）使用，跟我们场景不相关
 *   - 因此默认走 legacy `new Notification()`，仅当 legacy 抛错（少数 PWA 环境）才回退 SW
 *
 * 兼容：
 *   - HTTPS 必需（HTTP 站点浏览器禁用 Notification API）
 *   - permission 必须 granted（用户主动授权）
 *   - iOS Safari < 16 不支持桌面通知 → API 不存在时静默跳过
 *
 * 调试：所有路径都打 console 日志，方便用户排查
 */

let permissionGranted: boolean | null = null

/**
 * 检测是否运行在 PWA standalone 模式（被安装到桌面/主屏后启动）
 */
export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false
  if ((window.navigator as any).standalone === true) return true
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true
  if (window.matchMedia && window.matchMedia('(display-mode: window-controls-overlay)').matches) return true
  return false
}

/**
 * 检测当前环境是否支持桌面通知（API 存在 + HTTPS / localhost）
 */
export function canUseNotification(): { ok: boolean; reason?: string } {
  if (typeof window === 'undefined') return { ok: false, reason: '非浏览器环境' }
  if (!('Notification' in window)) return { ok: false, reason: '浏览器不支持 Notification API（iOS Safari < 16 / 老旧浏览器）' }
  // HTTPS / localhost 检查（chrome 强制要求）
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return { ok: false, reason: 'HTTP 站点不允许桌面通知（请用 HTTPS 访问）' }
  }
  return { ok: true }
}

/**
 * 当前权限状态：'granted' | 'denied' | 'default'（未询问）| 'unsupported'
 */
export function getNotificationPermission(): 'granted' | 'denied' | 'default' | 'unsupported' {
  const can = canUseNotification()
  if (!can.ok) return 'unsupported'
  return Notification.permission
}

/**
 * 请求浏览器通知权限。
 * 整个会话生命周期只弹一次授权框，之后走缓存。
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const can = canUseNotification()
  if (!can.ok) {
    console.warn('[notification] cannot use:', can.reason)
    return false
  }
  if (permissionGranted !== null) return permissionGranted

  if (Notification.permission === 'granted') {
    permissionGranted = true
    console.log('[notification] permission already granted')
    return true
  }

  if (Notification.permission === 'denied') {
    permissionGranted = false
    console.warn('[notification] permission denied (用户曾点过"屏蔽"，需到浏览器设置里手动重置)')
    return false
  }

  console.log('[notification] requesting permission...')
  const result = await Notification.requestPermission()
  permissionGranted = result === 'granted'
  console.log('[notification] permission result:', result)
  return permissionGranted
}

interface ShowNotificationOptions extends NotificationOptions {
  onClick?: () => void
  /**
   * 点击通知后的目标 URL（相对路径，如 "/orders?focus=123"）
   * 走 SW path 时，SW 会通过 postMessage 把这个 URL 转发给前端，
   * 前端 NotificationClickHandler 收到后用 react-router navigate 跳转。
   * legacy `new Notification()` path 也会用这个 URL（onclick 调 navigate）。
   */
  clickUrl?: string
}

/**
 * 内部：用 SW 路径发通知（用于手机锁屏 / 后台 / PWA 场景，可被 notificationclick 拦截）
 */
async function showViaServiceWorker(title: string, options: NotificationOptions): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, options)
      console.log('[notification] shown via SW:', title)
      return true
    }
  } catch (err) {
    console.warn('[notification] SW path failed:', err)
  }
  return false
}

/**
 * 发送系统通知（通知栏/锁屏）
 *
 * 策略（关键！）：
 *   - 优先 SW 路径（PWA / 手机锁屏 / 桌面后台时点击通知能被 notificationclick 捕获，跳转到目标页面）
 *   - SW 不可用时回退 `new Notification()`（dev 环境 / SW 还没注册）
 *
 * 这是 YouTube / Twitter / Discord 等大厂的标准做法。
 */
export async function showNotification(title: string, options?: ShowNotificationOptions) {
  const can = canUseNotification()
  if (!can.ok) {
    console.warn('[notification] showNotification skipped:', can.reason)
    return
  }
  if (Notification.permission !== 'granted') {
    console.warn('[notification] showNotification skipped: permission =', Notification.permission)
    return
  }

  const { onClick, clickUrl, ...rest } = options || {}
  // 把 clickUrl 塞进 data 里，让 SW 的 notificationclick 监听器能读到
  const swData = { url: clickUrl || '/', ...((rest as any).data || {}) }
  const notificationOptions: NotificationOptions = {
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: String(Date.now()),
    ...rest,
    data: swData,
  }

  // 优先：SW 路径 —— 关键场景（手机锁屏 / PWA 后台 / 桌面后台）必须走这里
  const swOk = await showViaServiceWorker(title, notificationOptions)
  if (swOk) return

  // 兜底：legacy `new Notification()` —— dev 环境 / SW 还没就绪时
  try {
    const n = new Notification(title, notificationOptions)
    n.onclick = () => {
      window.focus()
      n.close()
      // legacy path 的 click 处理：直接跳转
      if (clickUrl) {
        try {
          // 用 location.href 触发 react-router 路由（前端拦截 popstate）
          // 但更稳的是直接 navigate（这里没法访问 react-router context，让 NotificationClickHandler 监听 postMessage 也覆盖不到）
          // 解决：派发一个自定义事件，让 NotificationClickHandler 监听
          window.dispatchEvent(new CustomEvent('app:notification-click', { detail: { url: clickUrl } }))
        } catch { /* ignore */ }
      }
      onClick?.()
    }
    n.onerror = (err) => {
      console.warn('[notification] runtime error:', err)
    }
    console.log('[notification] shown (legacy):', title)
  } catch (err) {
    console.error('[notification] all paths failed:', err)
  }
}

/**
 * 测试通知（给"通知偏好"页的"立即测试"按钮调用）
 * 返回详细的诊断信息让用户/开发者排查
 */
export async function testNotification(): Promise<{ success: boolean; reason?: string }> {
  const can = canUseNotification()
  if (!can.ok) return { success: false, reason: can.reason }

  if (Notification.permission === 'denied') {
    return { success: false, reason: '通知权限已被拒绝。请到浏览器设置（地址栏左边🔒图标 → 通知 → 允许）重置后刷新页面' }
  }

  const granted = await requestNotificationPermission()
  if (!granted) {
    return { success: false, reason: '用户拒绝了通知权限请求' }
  }

  await showNotification('🔔 测试通知', {
    body: '如果你看到这条通知，说明系统通知工作正常',
  })
  return { success: true }
}
