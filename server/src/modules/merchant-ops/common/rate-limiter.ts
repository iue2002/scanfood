/**
 * 滑动窗口速率限制器（纯类）
 *
 * - per-key 独立窗口（key = userId 或 ip）
 * - 单调时钟驱动（注入 nowMs 函数，便于 PBT）
 * - O(1) 平均：每次 check 截断窗口外旧时间戳
 *
 * Property 23：消费 N 次后剩余配额 = max(0, limit - N)；
 *              超过 limit 立即拒绝；
 *              window 完全过去后配额恢复。
 */
export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** 距离窗口最早条目过期的 ms 数（被拒时给客户端 retry-after 用） */
  retryAfterMs: number;
}

export interface RateLimiterOpts {
  limit: number;       // 窗口内允许的最大请求数
  windowMs: number;    // 窗口大小，毫秒
}

export class SlidingWindowRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, number[]>();

  constructor(opts: RateLimiterOpts, private readonly nowMs: () => number = () => Date.now()) {
    if (!Number.isInteger(opts.limit) || opts.limit < 1) {
      throw new Error('SlidingWindowRateLimiter: limit must be a positive integer');
    }
    if (!Number.isFinite(opts.windowMs) || opts.windowMs <= 0) {
      throw new Error('SlidingWindowRateLimiter: windowMs must be > 0');
    }
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
  }

  /**
   * 尝试消费 1 次配额；返回是否允许 + 剩余配额
   */
  consume(key: string): RateLimitResult {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('SlidingWindowRateLimiter.consume: key required');
    }
    const now = this.nowMs();
    const cutoff = now - this.windowMs;
    let arr = this.buckets.get(key);
    if (!arr) {
      arr = [];
      this.buckets.set(key, arr);
    }
    // 截断过期（数组按时间升序）
    while (arr.length > 0 && arr[0] <= cutoff) {
      arr.shift();
    }
    if (arr.length >= this.limit) {
      // 拒绝：窗口最早条目还有多久过期
      const oldest = arr[0];
      const retryAfterMs = oldest + this.windowMs - now;
      return { ok: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) };
    }
    arr.push(now);
    return { ok: true, remaining: this.limit - arr.length, retryAfterMs: 0 };
  }

  /** 仅查询当前剩余配额（不消费） */
  peek(key: string): number {
    const now = this.nowMs();
    const cutoff = now - this.windowMs;
    const arr = this.buckets.get(key) ?? [];
    let cnt = 0;
    for (const t of arr) {
      if (t > cutoff) cnt++;
    }
    return Math.max(0, this.limit - cnt);
  }

  /** 测试用：清空 */
  reset(key?: string) {
    if (key === undefined) this.buckets.clear();
    else this.buckets.delete(key);
  }

  /**
   * 主动清理：移除所有"窗口内已无任何条目"的 key
   * 应在长期运行进程中定期调用（例如每 5 分钟），避免空桶占内存
   */
  sweep(): { removed: number } {
    const cutoff = this.nowMs() - this.windowMs;
    let removed = 0;
    for (const [key, arr] of this.buckets) {
      // 清理过期条目
      while (arr.length > 0 && arr[0] <= cutoff) arr.shift();
      if (arr.length === 0) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return { removed };
  }

  /** 当前桶数（监控用） */
  size(): number {
    return this.buckets.size;
  }
}
