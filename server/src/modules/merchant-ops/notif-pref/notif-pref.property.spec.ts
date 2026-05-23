/**
 * Feature: merchant-ops-center, Property 11/12: NotifPref invariants
 * Validates: Requirements 9.3, 10.1, 10.2, 10.7
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { NotifPrefCore } from './notif-pref.core';
import { ALL_DESKTOP_EVENTS } from './notif-pref.types';
import type { DesktopEvent, NotifPrefDto, SoundCatalog } from './notif-pref.types';

const STUB_CATALOG: SoundCatalog = {
  ids: ['default', 'ding', 'bell'],
  entries: [
    { id: 'default', label: '默认', url: '/sounds/default.mp3', durationMs: 1500 },
    { id: 'ding', label: '清脆', url: '/sounds/ding.mp3', durationMs: 800 },
    { id: 'bell', label: '柜台', url: '/sounds/bell.mp3', durationMs: 1200 },
  ],
};

// ============================================================
// Property 11: 通知偏好校验
// ============================================================
describe('Feature: merchant-ops-center, Property 11: NotifPref validation', () => {
  it('accepts iff sound_id ∈ catalog.ids AND desktop_events ⊆ allowed events', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        // sound_id：50% 取自合法集合，50% 随机生成
        fc.oneof(
          fc.constantFrom('default', 'ding', 'bell'),
          fc.string({ minLength: 1, maxLength: 20 }),
        ),
        // desktop_events：随机数组，元素 50% 取自合法集，50% 随机字符串（含重复）
        fc.array(
          fc.oneof(
            fc.constantFrom('NEW_ORDER', 'ADD_ITEM', 'REFUND'),
            fc.string({ minLength: 1, maxLength: 12 }),
          ),
          { minLength: 0, maxLength: 8 },
        ),
        (sound_enabled, sound_id, desktop_events) => {
          const dto: NotifPrefDto = {
            sound_enabled,
            sound_id,
            desktop_events: desktop_events as DesktopEvent[],
          };
          const result = NotifPrefCore.validate(dto, STUB_CATALOG);

          const soundOk = STUB_CATALOG.ids.includes(sound_id);
          const allowedSet = new Set<string>(ALL_DESKTOP_EVENTS);
          const eventsOk = desktop_events.every((e) => allowedSet.has(e));
          const expected = soundOk && eventsOk;

          if (expected) {
            if (!result.ok) return false;
            // 重复元素不影响接受性 → normalized 是去重后的合法集
            const dedup = new Set(desktop_events);
            return result.normalized.desktop_events.length === dedup.size;
          }
          return result.ok === false && result.code === 'NOTIF_PREF_INVALID';
        },
      ),
      { numRuns: 200 },
    );
  });

  it('idempotent: validate(validate(dto)) returns same normalized', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.constantFrom('default', 'ding', 'bell'),
        fc.array(fc.constantFrom('NEW_ORDER', 'ADD_ITEM', 'REFUND'), { minLength: 0, maxLength: 8 }),
        (enabled, sid, events) => {
          const dto: NotifPrefDto = {
            sound_enabled: enabled,
            sound_id: sid,
            desktop_events: events as DesktopEvent[],
          };
          const r1 = NotifPrefCore.validate(dto, STUB_CATALOG);
          if (!r1.ok) return false;
          const r2 = NotifPrefCore.validate(r1.normalized, STUB_CATALOG);
          if (!r2.ok) return false;
          // 第二次结果与第一次完全一致
          return JSON.stringify(r1.normalized) === JSON.stringify(r2.normalized);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects non-array desktop_events', () => {
    const result = NotifPrefCore.validate(
      { sound_enabled: true, sound_id: 'default', desktop_events: 'NEW_ORDER' as any },
      STUB_CATALOG,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects non-boolean sound_enabled', () => {
    const result = NotifPrefCore.validate(
      { sound_enabled: 'yes' as any, sound_id: 'default', desktop_events: [] },
      STUB_CATALOG,
    );
    expect(result.ok).toBe(false);
  });
});

// ============================================================
// Property 12: 通知不漏 (toast/desktop ⊥ sound)
//
// 把 NotificationCenter 的关键决策抽出为一个纯函数（PBT 友好）：
// "决策模型"：给定事件、偏好、声音失败标记、通知权限 → 输出三个布尔（playSound, showToast, showDesktop）
// 不变量：声音失败 → playSound=false，但不影响 toast/desktop。
// 这与 admin-web NotificationCenter 实现共用同一个决策函数（导出后两端复用）。
// ============================================================
import { decideNotificationChannels } from './notification-decision';

describe('Feature: merchant-ops-center, Property 12: notification toast/desktop ⊥ sound', () => {
  it('sound failure never suppresses toast or desktop', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<DesktopEvent>('NEW_ORDER', 'ADD_ITEM', 'REFUND'),
        fc.boolean(),
        fc.constantFrom('default', 'ding', 'bell'),
        fc.subarray(['NEW_ORDER', 'ADD_ITEM', 'REFUND'] as DesktopEvent[]),
        fc.boolean(), // soundFailed
        fc.constantFrom<'granted' | 'denied' | 'default'>('granted', 'denied', 'default'),
        (event, soundEnabled, soundId, desktopEvents, soundFailed, permission) => {
          const pref = {
            sound_enabled: soundEnabled,
            sound_id: soundId,
            desktop_events: desktopEvents,
          };
          const decision = decideNotificationChannels(event, pref, soundFailed, permission);

          // toast 必须始终为 true（R10.7：不漏通知）
          if (decision.showToast !== true) return false;

          // 桌面通知：当 e ∈ pref.desktop_events ∧ permission='granted'
          const expectDesktop = desktopEvents.includes(event) && permission === 'granted';
          if (decision.showDesktop !== expectDesktop) return false;

          // 声音：sound_enabled ∧ ¬soundFailed
          const expectSound = soundEnabled && !soundFailed;
          if (decision.playSound !== expectSound) return false;

          // 关键正交性：soundFailed 不会改变 toast/desktop 取值
          const decisionWithoutFailure = decideNotificationChannels(event, pref, false, permission);
          if (decision.showToast !== decisionWithoutFailure.showToast) return false;
          if (decision.showDesktop !== decisionWithoutFailure.showDesktop) return false;

          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('explicitly: soundFailed=true keeps toast and desktop unchanged', () => {
    const pref = {
      sound_enabled: true,
      sound_id: 'default',
      desktop_events: ['NEW_ORDER'] as DesktopEvent[],
    };
    const ok = decideNotificationChannels('NEW_ORDER', pref, false, 'granted');
    const failed = decideNotificationChannels('NEW_ORDER', pref, true, 'granted');
    expect(ok.showToast).toBe(true);
    expect(failed.showToast).toBe(true);
    expect(ok.showDesktop).toBe(true);
    expect(failed.showDesktop).toBe(true);
    expect(ok.playSound).toBe(true);
    expect(failed.playSound).toBe(false);
  });
});
