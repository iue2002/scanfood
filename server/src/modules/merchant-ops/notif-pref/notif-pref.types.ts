/**
 * 通知偏好领域类型定义（前后端共享语义）
 */

export type DesktopEvent = 'NEW_ORDER' | 'ADD_ITEM' | 'REFUND';

export const ALL_DESKTOP_EVENTS: ReadonlyArray<DesktopEvent> = ['NEW_ORDER', 'ADD_ITEM', 'REFUND'];

export interface SoundEntry {
  id: string;
  label: string;
  /** 指向 TOS 对象存储的 URL（R9.4） */
  url: string;
  durationMs: number;
}

export interface SoundCatalog {
  /** 按 id 查找；至少包含一个 id === 'default' */
  ids: ReadonlyArray<string>;
  entries: ReadonlyArray<SoundEntry>;
}

export interface NotifPrefRow {
  user_id: number;
  sound_enabled: boolean;
  sound_id: string;
  desktop_events: DesktopEvent[];
  updated_at: Date;
}

export interface NotifPrefDto {
  sound_enabled: boolean;
  sound_id: string;
  desktop_events: DesktopEvent[];
}

export const DEFAULT_PREF: Omit<NotifPrefRow, 'user_id' | 'updated_at'> = {
  sound_enabled: true,
  sound_id: 'default',
  desktop_events: ['NEW_ORDER'],
};
