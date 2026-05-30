/**
 * MysqlTtlStore：TtlStorePort 的 MySQL 实现
 *
 * 使用 INSERT ... ON DUPLICATE KEY UPDATE 实现原子 upsert。
 * get() 自动跳过过期键并清理。
 */
import { Injectable, Logger } from '@nestjs/common';
import type { TtlStorePort } from '../ports/ttl-store.port';
import { db } from '@/storage/database/mysql-client';
import { ttlKvStore } from '@/storage/database/shared/schema';
import { eq, lt, sql } from 'drizzle-orm';

export const TTL_STORE_TOKEN = 'TtlStorePort';

@Injectable()
export class MysqlTtlStore implements TtlStorePort {
  private readonly logger = new Logger(MysqlTtlStore.name);

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMs);
    const valueJson = JSON.parse(JSON.stringify(value));

    await db.insert(ttlKvStore).values({
      store_key: key,
      value_json: valueJson,
      expires_at: expiresAt,
    }).onDuplicateKeyUpdate({
      set: {
        value_json: valueJson,
        expires_at: expiresAt,
      },
    });
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const now = new Date();
    const rows = await db.select()
      .from(ttlKvStore)
      .where(eq(ttlKvStore.store_key, key))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0];
    if (new Date(row.expires_at) <= now) {
      void this.delete(key); // fire-and-forget cleanup
      return null;
    }

    return (row.value_json as unknown) as T;
  }

  async delete(key: string): Promise<void> {
    await db.delete(ttlKvStore).where(eq(ttlKvStore.store_key, key));
  }

  async increment(key: string, delta: number, ttlMs: number): Promise<number> {
    const expiresAt = new Date(Date.now() + ttlMs);
    const now = new Date();

    // 先尝试读取当前值
    const existing = await db.select()
      .from(ttlKvStore)
      .where(eq(ttlKvStore.store_key, key))
      .limit(1);

    let currentValue = 0;
    if (existing.length > 0 && new Date(existing[0].expires_at) > now) {
      currentValue = (existing[0].value_json as any)?.count ?? 0;
    }

    const newValue = currentValue + delta;
    const valueJson = { count: newValue };

    await db.insert(ttlKvStore).values({
      store_key: key,
      value_json: valueJson,
      expires_at: expiresAt,
    }).onDuplicateKeyUpdate({
      set: {
        value_json: valueJson,
        expires_at: expiresAt,
      },
    });

    return newValue;
  }
}
