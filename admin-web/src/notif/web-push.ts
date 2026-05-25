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
 *   - 安卓浏览器 → FCM 被墙，订阅会报 'push service error'
 */
import request from '@/api/request'

export interface PushCapability {
  supported: boolean
  reason?: string
  /** 当前是否已订阅 */
  subscribed: boolean
  /** 平台分类（用于 UI 提示） */
  platform: 'edge-desktop' | 'chrome-desktop' | 'firefox-desktop' | 'safari-ios' | 'android' | 'other'
  /** 是否大概率被墙（安卓 + 国内） */
  likelyBlocked: boolean
}

/** 粗略检测平台，用于针对性提示 */
function detectPlatform(): PushCapability['platform'] {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  // iOS（iPhone / iPad / iPod）
  if (/iPhone|iPad|iPod/i.test(ua)) return 'safari-ios'
  // 安卓（先于其它判断，因为安卓 Edge/Chrome 都受 FCM 限制）
  if (/Android/i.test(ua)) return 'android'
  // 桌面 Edge
  if (/Edg\//i.test(ua)) return 'edge-desktop'
  // 桌面 Firefox
  if (/Firefox\//i.test(ua)) return 'firefox-desktop'
  // 桌面 Chrome（不含 Edg）
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return 'chrome-desktop'
  return 'other'
}

export async function detectPushCapability(): Promise<PushCapability> {
  const platform = detectPlatform()
  // 安卓走 FCM，国内 99% 失败：直接给前置提示，让用户走邮件兜底
  const likelyBlocked = platform === 'android'

  if (typeof window === 'undefined') {
    return { supported: false, reason: '非浏览器环境', subscribed: false, platform, likelyBlocked }
  }
  if (!('serviceWorker' in navigator)) {
    return { supported: false, reason: '浏览器不支持 Service Worker', subscribed: false, platform, likelyBlocked }
  }
  if (!('PushManager' in window)) {
    return { supported: false, reason: '浏览器不支持 Web Push', subscribed: false, platform, likelyBlocked }
  }
  if (!('Notification' in window)) {
    return { supported: false, reason: '浏览器不支持 Notification API', subscribed: false, platform, likelyBlocked }
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) {
      return {
        supported: true,
        reason: 'Service Worker 尚未就绪，请刷新页面后重试',
        subscribed: false,
        platform,
        likelyBlocked,
      }
    }
    const sub = await reg.pushManager.getSubscription()
    return { supported: true, subscribed: !!sub, platform, likelyBlocked }
  } catch (err) {
    return {
      supported: false,
      reason: '检测推送能力失败：' + (err as Error).message,
      subscribed: false,
      platform,
      likelyBlocked,
    }
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
 * 把 PushManager.subscribe 的原始错误翻译成对店主友好的中文提示
 */
function humanizeSubscribeError(err: any, platform: PushCapability['platform']): string {
  const msg = err?.message || String(err)
  // 国内最常见的失败：安卓 FCM 被墙
  if (/push service error|Registration failed/i.test(msg)) {
    if (platform === 'android') {
      return '安卓浏览器无法连接 Google FCM 推送服务（国内被墙），请改用「邮件兜底」接收通知，或在 iPhone Safari、电脑 Edge 上启用强力推送。'
    }
    return '推送服务连接失败：当前网络/浏览器无法访问推送服务（国内 Chrome/Firefox 走 Google 节点常被屏蔽）。建议改用邮件兜底，或换成 Edge 浏览器。'
  }
  if (/permission denied|NotAllowedError/i.test(msg)) {
    return '通知权限被浏览器拒绝。请到浏览器设置 → 站点权限 → 允许通知后重试。'
  }
  if (/Already.*subscribed/i.test(msg)) {
    return '本设备已订阅过；请先「取消订阅」再重新开启。'
  }
  if (/AbortError/i.test(msg)) {
    return '订阅过程被中断，请重试一次。'
  }
  if (/InvalidStateError/i.test(msg)) {
    return 'Service Worker 状态异常，请刷新整页面后重试。'
  }
  return 'PushManager.subscribe 失败：' + msg
}

/**
 * 订阅 Web Push
 * @returns 成功/失败 + 失败原因
 */
export async function subscribePush(): Promise<{ ok: boolean; reason?: string }> {
  const platform = detectPlatform()

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
    return { ok: false, reason: humanizeSubscribeError(err, platform) }
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
