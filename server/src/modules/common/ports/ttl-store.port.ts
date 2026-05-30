/**
 * TtlStorePort：TTL 键值存储抽象
 *
 * P1-2：替代内存 Map，服务重启后状态不丢
 * 当前 MySQL Adapter，未来可直接替换为 Redis
 */

export interface TtlStorePort {
  /** 写入键值，带 TTL（ms 级别） */
  set(key: string, value: unknown, ttlMs: number): Promise<void>;

  /** 读取键值（未过期返回 value，过期返回 null） */
  get<T = unknown>(key: string): Promise<T | null>;

  /** 删除键 */
  delete(key: string): Promise<void>;

  /** 自增计数器（首次调用自动创建 key + 设置 TTL；返回递增后的值） */
  increment(key: string, delta: number, ttlMs: number): Promise<number>;
}
