/**
 * 通知通道决策函数（前端镜像版，与 server 端 notif-pref/notification-decision.ts 严格一致）
 *
 * Property 12 在后端 PBT 中验证；前端复用同一份逻辑，避免双端漂移。
 */
export type DesktopEvent = 'NEW_ORDER' | 'ADD_ITEM' | 'REFUND'

export const ALL_DESKTOP_EVENTS: ReadonlyArray<DesktopEvent> = ['NEW_ORDER', 'ADD_ITEM', 'REFUND']

export interface MinimalPref {
  sound_enabled: boolean
  sound_id: string
  desktop_events: DesktopEvent[]
}

export interface NotificationDecision {
  playSound: boolean
  showToast: boolean
  showDesktop: boolean
}

export function decideNotificationChannels(
  event: DesktopEvent,
  pref: MinimalPref,
  soundFailed: boolean,
  notificationPermission: 'granted' | 'denied' | 'default',
): NotificationDecision {
  const showToast = true
  const showDesktop = pref.desktop_events.includes(event) && notificationPermission === 'granted'
  const playSound = pref.sound_enabled && !soundFailed
  return { playSound, showToast, showDesktop }
}
