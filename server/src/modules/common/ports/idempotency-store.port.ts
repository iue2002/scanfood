/**
 * IdempotencyStorePort: 幂等存储抽象
 *
 * P0-4：订单/加菜/结账幂等保障
 * 当前 MySQL Adapter，未来可替换为 Redis Adapter
 */

export type IdempotencyResult = 'started' | 'replay' | 'conflict';

export interface IdempotencyStorePort {
  /**
   * 尝试开始一次幂等操作
   * @returns 'started' — 首次请求，可以继续执行
   *          'replay' — 重复请求（相同 key + 相同 hash），返回上次缓存的响应
   *          'conflict' — 相同 key 但不同 hash，拒绝（防止内容不一致的重试）
   */
  begin(params: {
    scope: string;
    key: string;
    requestHash: string;
    actorId?: number;
  }): Promise<{ result: IdempotencyResult; cachedResponse?: unknown }>;

  /** 标记幂等操作成功，缓存响应 */
  complete(params: {
    scope: string;
    key: string;
    response: unknown;
  }): Promise<void>;

  /** 标记幂等操作失败（可重试） */
  fail(params: {
    scope: string;
    key: string;
    reason: string;
  }): Promise<void>;
}
