/**
 * 通知偏好 store（zustand 风格，但项目这里直接用 module-level state + 订阅）
 * 提供：
 *  - 加载偏好（首次从后端拉取，失败时回退 localStorage）
 *  - 保存偏好（PUT 到后端 + 写 localStorage）
 *  - 拉取音色清单
 *  - 选择性订阅
 */
import request from '@/api/request'
import type { DesktopEvent, MinimalPref } from './notification-decision'

const STORAGE_KEY = 'mop:notif-pref'

export interface NotifPrefRow extends MinimalPref {
  user_id: number
  updated_at: string
}

export interface SoundEntry {
  id: string
  label: string
  url: string
  durationMs: number
}

const DEFAULT_PREF: MinimalPref = {
  sound_enabled: true,
  sound_id: 'default',
  desktop_events: ['NEW_ORDER'],
}

let cached: MinimalPref = readFromStorage() ?? { ...DEFAULT_PREF }
const subscribers = new Set<() => void>()

function readFromStorage(): MinimalPref | null {
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
      return {
        sound_enabled: obj.sound_enabled,
        sound_id: obj.sound_id,
        desktop_events: obj.desktop_events.filter(
          (e: any): e is DesktopEvent => e === 'NEW_ORDER' || e === 'ADD_ITEM' || e === 'REFUND',
        ),
      }
    }
  } catch {
    // 忽略损坏 localStorage
  }
  return null
}

function writeToStorage(pref: MinimalPref) {
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

export function getNotifPref(): MinimalPref {
  return cached
}

export function subscribeNotifPref(fn: () => void): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

/** 从后端加载偏好；失败时使用 localStorage 兜底 */
export async function loadNotifPref(): Promise<MinimalPref> {
  try {
    const res: any = await request.get<{ data: NotifPrefRow }>('/merchant-ops/notification-preferences/me')
    const row: NotifPrefRow = res?.data ?? res
    if (row && typeof row.sound_enabled === 'boolean') {
      const next: MinimalPref = {
        sound_enabled: row.sound_enabled,
        sound_id: row.sound_id,
        desktop_events: Array.isArray(row.desktop_events) ? row.desktop_events : [],
      }
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
export async function saveNotifPref(next: MinimalPref): Promise<MinimalPref> {
  const res: any = await request.put('/merchant-ops/notification-preferences/me', next)
  const row: NotifPrefRow | undefined = res?.data ?? res
  const final: MinimalPref = row ? {
    sound_enabled: row.sound_enabled,
    sound_id: row.sound_id,
    desktop_events: Array.isArray(row.desktop_events) ? row.desktop_events : [],
  } : next
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
