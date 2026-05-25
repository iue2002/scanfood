/**
 * Web Push 订阅 utility
 *
 * 流程：
 *   1. 检测 SW 是否注册 + push 是否支持
 *   2. 检查 Notification 权限（必须 granted）
 *   3. 调 /api/notif/push/vapid-key 拿公钥
 *   4. PushManager.subscribe({ applicationServerKey })
 *   5. POST /api/notif/push/subscribe 上报后端
 *
 * 国内可用性：
 *   - 桌面 Edge / iOS Safari PWA → 完美
 *   - 安卓浏览器 → FCM 不稳，UI 层应提示用户
 */
import request from '@/api/request'

export interface PushCapability {
  supported: boolean
  reason?: string
  /** 当前是否已订阅 */
  subscribed: boolean
}

export async function detectPushCapability(): Promise<PushCapability> {
  if (typeof window === 'undefined') {
    return { supported: false, reason: '非浏览器环境', subscribed: false }
  }
  if (!('serviceWorker' in navigator)) {
    return { supported: false, reason: '浏览器不支持 Service Worker', subscribed: false }
  }
  if (!('PushManager' in window)) {
    return { supported: false, reason: '浏览器不支持 Web Push', subscribed: false }
  }
  if (!('Notification' in window)) {
    return { supported: false, reason: '浏览器不支持 Notification API', subscribed: false }
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) {
      return { supported: true, reason: 'Service Worker 尚未就绪，请刷新页面后重试', subscribed: false }
    }
    const sub = await reg.pushManager.getSubscription()
    return { supported: true, subscribed: !!sub }
  } catch (err) {
    return { supported: false, reason: '检测推送能力失败：' + (err as Error).message, subscribed: false }
  }
}

/**
 * VAPID 公钥（base64url）→ Uint8Array
 * Web Push API 要求 applicationServerKey 是 Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

interface VapidKeyResponse {
  enabled: boolean
  publicKey: string
}

/**
 * 订阅 Web Push
 * @returns 成功/失败 + 失败原因
 */
export async function subscribePush(): Promise<{ ok: boolean; reason?: string }> {
  // 1. 权限
  if (Notification.permission !== 'granted') {
    return { ok: false, reason: '通知权限未授予' }
  }

  // 2. 拿 VAPID 公钥
  const vapidRes = await request.get<any, VapidKeyResponse>('/notif/push/vapid-key').catch(() => null)
  if (!vapidRes || !vapidRes.enabled || !vapidRes.publicKey) {
    return { ok: false, reason: '服务端未配置 Web Push（VAPID 缺失）' }
  }

  // 3. SW + subscribe
  const reg = await navigator.serviceWorker.ready
  let sub: PushSubscription
  try {
    // 先看是否已订阅
    const existing = await reg.pushManager.getSubscription()
    if (existing) {
      sub = existing
    } else {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidRes.publicKey),
      })
    }
  } catch (err: any) {
    return { ok: false, reason: 'PushManager.subscribe 失败：' + (err?.message || '未知错误') }
  }

  // 4. 上报后端
  const json = sub.toJSON() as PushSubscriptionJSON & { keys?: { p256dh?: string; auth?: string } }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: 'PushSubscription 数据不完整' }
  }
  try {
    await request.post('/notif/push/subscribe', {
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 500),
    })
  } catch (err: any) {
    return { ok: false, reason: '上报订阅到服务端失败：' + (err?.message || '未知错误') }
  }
  return { ok: true }
}

/**
 * 取消订阅 Web Push
 */
export async function unsubscribePush(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return { ok: true } // 没注册过 sw，视为已取消
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return { ok: true }
    const endpoint = sub.endpoint
    // 先告诉后端，再本地取消（后端清失败也无所谓，浏览器层取消即可彻底关闭）
    try {
      await request.post('/notif/push/unsubscribe', { endpoint })
    } catch { /* ignore */ }
    await sub.unsubscribe()
    return { ok: true }
  } catch (err: any) {
    return { ok: false, reason: '取消订阅失败：' + (err?.message || '未知错误') }
  }
}
