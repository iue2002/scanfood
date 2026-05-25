/**
 * 通知偏好 store（zustand 风格，但项目这里直接用 module-level state + 订阅）
 * 提供：
 *  - 加载偏好（首次从后端拉取，失败时回退 localStorage）
 *  - 保存偏好（PUT 到后端 + 写 localStorage）
 *  - 拉取音色清单
 *  - 选择性订阅
 *
 * 多通道扩展：
 *  - email：员工接收邮件通知的邮箱（空串/null = 关闭）
 *  - email_events：订阅哪些事件（与 desktop_events 同集合，但独立选择）
 */
import request from '@/api/request'
import type { DesktopEvent, MinimalPref } from './notification-decision'

const STORAGE_KEY = 'mop:notif-pref'

/** 前端扩展版本：包含邮件字段（可选） */
export interface ExtendedPref extends MinimalPref {
  email: string | null
  email_events: DesktopEvent[]
}

export interface NotifPrefRow extends ExtendedPref {
  user_id: number
  updated_at: string
}

export interface SoundEntry {
  id: string
  label: string
  url: string
  durationMs: number
}

const DEFAULT_PREF: ExtendedPref = {
  sound_enabled: true,
  sound_id: 'default',
  desktop_events: ['NEW_ORDER'],
  email: null,
  email_events: [],
}

let cached: ExtendedPref = readFromStorage() ?? { ...DEFAULT_PREF }
const subscribers = new Set<() => void>()

function readFromStorage(): ExtendedPref | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (
      typeof obj === 'object' &&
      obj !== null &&
      typeof obj.sound_enabled === 'boolean' &&
      typeof obj.sound_id === 'string' &&
      Array.isArray(obj.desktop_events)
    ) {
      const desktop_events = obj.desktop_events.filter(
        (e: any): e is DesktopEvent => e === 'NEW_ORDER' || e === 'ADD_ITEM' || e === 'REFUND',
      )
      const email = typeof obj.email === 'string' && obj.email.length > 0 ? obj.email : null
      const email_events = Array.isArray(obj.email_events)
        ? obj.email_events.filter(
            (e: any): e is DesktopEvent => e === 'NEW_ORDER' || e === 'ADD_ITEM' || e === 'REFUND',
          )
        : []
      return {
        sound_enabled: obj.sound_enabled,
        sound_id: obj.sound_id,
        desktop_events,
        email,
        email_events,
      }
    }
  } catch {
    // 忽略损坏 localStorage
  }
  return null
}

function writeToStorage(pref: ExtendedPref) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pref))
  } catch {
    // quota / disabled storage：忽略
  }
}

function notify() {
  for (const fn of subscribers) {
    try { fn() } catch { /* ignore */ }
  }
}

export function getNotifPref(): ExtendedPref {
  return cached
}

export function subscribeNotifPref(fn: () => void): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

function normalizeRow(row: Partial<NotifPrefRow>): ExtendedPref {
  return {
    sound_enabled: !!row.sound_enabled,
    sound_id: row.sound_id ?? 'default',
    desktop_events: Array.isArray(row.desktop_events) ? row.desktop_events : [],
    email: typeof row.email === 'string' && row.email.length > 0 ? row.email : null,
    email_events: Array.isArray(row.email_events) ? row.email_events : [],
  }
}

/** 从后端加载偏好；失败时使用 localStorage 兜底 */
export async function loadNotifPref(): Promise<ExtendedPref> {
  try {
    const res: any = await request.get<{ data: NotifPrefRow }>('/merchant-ops/notification-preferences/me')
    const row: NotifPrefRow = res?.data ?? res
    if (row && typeof row.sound_enabled === 'boolean') {
      const next = normalizeRow(row)
      cached = next
      writeToStorage(next)
      notify()
      return next
    }
  } catch {
    // 网络故障：使用 localStorage 缓存（已在 module 加载时读入 cached）
  }
  return cached
}

/** 保存到后端 + localStorage */
export async function saveNotifPref(next: ExtendedPref): Promise<ExtendedPref> {
  // 后端 DTO：未传字段保留旧值，所以全量发上去最安全
  const payload: any = {
    sound_enabled: next.sound_enabled,
    sound_id: next.sound_id,
    desktop_events: next.desktop_events,
    email: next.email ?? null,
    email_events: next.email_events,
  }
  const res: any = await request.put('/merchant-ops/notification-preferences/me', payload)
  const row: NotifPrefRow | undefined = res?.data ?? res
  const final: ExtendedPref = row ? normalizeRow(row) : next
  cached = final
  writeToStorage(final)
  notify()
  return final
}

export async function listSounds(): Promise<SoundEntry[]> {
  const res: any = await request.get<{ data: SoundEntry[] }>('/merchant-ops/notification-preferences/sounds')
  const list: SoundEntry[] = res?.data ?? res
  return Array.isArray(list) ? list : []
}
