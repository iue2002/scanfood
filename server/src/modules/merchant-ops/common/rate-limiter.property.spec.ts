/**
 * Feature: merchant-ops-center, Property 23: rate limiter sliding window
 * Validates: Requirements 20.6
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SlidingWindowRateLimiter } from './rate-limiter';

describe('Feature: merchant-ops-center, Property 23: SlidingWindowRateLimiter', () => {
  it('after N consume()s, remaining = max(0, limit - N) for N ≤ limit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),  // limit
        fc.integer({ min: 0, max: 50 }),  // attempts
        (limit, attempts) => {
          let now = 0;
          const rl = new SlidingWindowRateLimiter({ limit, windowMs: 60_000 }, () => now);
          let allowed = 0;
          for (let i = 0; i < attempts; i++) {
            const r = rl.consume('user:1');
            if (r.ok) allowed += 1;
          }
          // 不变量 1：允许的次数 ≤ min(limit, attempts)
          if (allowed > Math.min(limit, attempts)) return false;
          // 不变量 2：peek 等于 max(0, limit - allowed)
          const remaining = rl.peek('user:1');
          return remaining === Math.max(0, limit - allowed);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('over-limit attempts immediately rejected with retryAfterMs > 0', () => {
    const rl = new SlidingWindowRateLimiter({ limit: 5, windowMs: 60_000 });
    for (let i = 0; i < 5; i++) {
      expect(rl.consume('user:1').ok).toBe(true);
    }
    const rejected = rl.consume('user:1');
    expect(rejected.ok).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
    expect(rejected.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('after window fully elapses, full quota restored', () => {
    let now = 0;
    const rl = new SlidingWindowRateLimiter({ limit: 3, windowMs: 60_000 }, () => now);
    for (let i = 0; i < 3; i++) {
      expect(rl.consume('u').ok).toBe(true);
    }
    expect(rl.consume('u').ok).toBe(false);
    // 推进窗口刚好过去 60s
    now = 60_001;
    expect(rl.consume('u').ok).toBe(true);
    expect(rl.peek('u')).toBe(2);
  });

  it('per-key isolation: user1 hitting limit does not affect user2', () => {
    const rl = new SlidingWindowRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(rl.consume('u1').ok).toBe(true);
    expect(rl.consume('u1').ok).toBe(true);
    expect(rl.consume('u1').ok).toBe(false);
    // u2 仍有满配额
    expect(rl.consume('u2').ok).toBe(true);
    expect(rl.consume('u2').ok).toBe(true);
    expect(rl.consume('u2').ok).toBe(false);
  });

  it('time-shifted PBT: consume sequence with random time gaps preserves limit invariant', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),  // limit
        fc.integer({ min: 1000, max: 60_000 }),  // windowMs
        fc.array(fc.integer({ min: 0, max: 90_000 }), { minLength: 1, maxLength: 30 }),
        (limit, windowMs, gaps) => {
          let now = 0;
          const rl = new SlidingWindowRateLimiter({ limit, windowMs }, () => now);
          let allowedHistory: number[] = []; // 记录所有 ok 的时间戳
          for (const gap of gaps) {
            now += gap;
            const r = rl.consume('u');
            if (r.ok) {
              allowedHistory.push(now);
            }
          }
          // 不变量：任意时间窗口 [t-windowMs, t] 内的 allowed 次数 ≤ limit
          for (const t of allowedHistory) {
            const cnt = allowedHistory.filter((x) => x > t - windowMs && x <= t).length;
            if (cnt > limit) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects bad config', () => {
    expect(() => new SlidingWindowRateLimiter({ limit: 0, windowMs: 1000 })).toThrow();
    expect(() => new SlidingWindowRateLimiter({ limit: 1.5, windowMs: 1000 })).toThrow();
    expect(() => new SlidingWindowRateLimiter({ limit: 5, windowMs: 0 })).toThrow();
    expect(() => new SlidingWindowRateLimiter({ limit: 5, windowMs: -1 })).toThrow();
  });
});
