/**
 * 通知通道决策函数（纯函数，前后端共享）
 *
 * I12 不变量：声音通道失败时不影响 toast/desktop（即三个通道正交）。
 * Property 12 在 PBT 中验证。
 *
 * 前端 admin-web NotificationCenter 应当镜像调用同一份逻辑（或复用本文件）。
 */
import type { DesktopEvent } from './notif-pref.types';

export interface MinimalPref {
  sound_enabled: boolean;
  sound_id: string;
  desktop_events: DesktopEvent[];
}

export interface NotificationDecision {
  /** 是否播放声音 */
  playSound: boolean;
  /** 是否弹 toast（始终 true：R10.7 不漏通知） */
  showToast: boolean;
  /** 是否弹桌面通知 */
  showDesktop: boolean;
}

/**
 * 给定事件、偏好、声音通道失败标记、桌面通知权限 → 决定三个通道的开闭
 */
export function decideNotificationChannels(
  event: DesktopEvent,
  pref: MinimalPref,
  soundFailed: boolean,
  notificationPermission: 'granted' | 'denied' | 'default',
): NotificationDecision {
  // R10.7: toast 始终要展示，不论声音是否失败、不论权限状态
  const showToast = true;

  // 桌面通知：事件 ∈ pref.desktop_events 且浏览器权限为 granted
  const showDesktop = pref.desktop_events.includes(event) && notificationPermission === 'granted';

  // 声音：用户开启 ∧ 通道未失败
  const playSound = pref.sound_enabled && !soundFailed;

  return { playSound, showToast, showDesktop };
}
