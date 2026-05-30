/**
 * MysqlDistributedLock：DistributedLockPort 的 MySQL 实现（P3-1）
 *
 * 使用 MySQL 内置函数 GET_LOCK / RELEASE_LOCK。
 * - GET_LOCK(name, timeout)：获取命名锁，timeout 为等待秒数（不是 TTL）
 * - RELEASE_LOCK(name)：释放锁
 *
 * 限制：
 * - 锁名长度 ≤ 64 字符（MySQL 限制）
 * - GET_LOCK 是 session 级锁，连接断开自动释放
 * - 不适合高频率争用场景（未来应切 Redis）
 */
import { Injectable, Logger } from '@nestjs/common';
import { pool } from '@/storage/database/mysql-client';
import type { DistributedLockPort } from '../ports/distributed-lock.port';

@Injectable()
export class MysqlDistributedLock implements DistributedLockPort {
  private readonly logger = new Logger(MysqlDistributedLock.name);

  /**
   * 获取锁
   * @param key 锁标识（≤64 字符）
   * @param ttlMs 最晚获取等待时间（毫秒），超时放弃
   */
  async acquire(key: string, ttlMs: number): Promise<boolean> {
    try {
      const timeoutSec = Math.max(0, Math.floor(ttlMs / 1000));
      const [rows] = await pool.query<any>(
        'SELECT GET_LOCK(?, ?) AS locked',
        [key.slice(0, 64), timeoutSec],
      );
      return rows?.[0]?.locked === 1;
    } catch (err: any) {
      this.logger.warn(`[lock] acquire "${key}" failed: ${err?.message}`);
      return false;
    }
  }

  /**
   * 释放锁
   */
  async release(key: string): Promise<void> {
    try {
      await pool.query<any>('SELECT RELEASE_LOCK(?)', [key.slice(0, 64)]);
    } catch (err: any) {
      this.logger.warn(`[lock] release "${key}" failed: ${err?.message}`);
    }
  }
}
