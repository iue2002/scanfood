/**
 * DistributedLockPort：分布式锁抽象（P3-1）
 *
 * 当前 MySQL Adapter 使用 GET_LOCK / RELEASE_LOCK，
 * 未来可替换为 Redis SET NX EX 或 Redlock。
 */
export interface DistributedLockPort {
  /** 获取锁，返回 true 表示获取成功 */
  acquire(key: string, ttlMs: number): Promise<boolean>;
  /** 释放锁 */
  release(key: string): Promise<void>;
}
