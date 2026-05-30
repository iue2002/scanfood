/**
 * MysqlIdempotencyStore: IdempotencyStorePort 的 MySQL 实现
 *
 * 使用 INSERT ... ON DUPLICATE KEY 实现原子性幂等检测。
 * status 流转：processing → success / failed
 * recycle() 方法应由定时任务调用清理过期记录。
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IdempotencyStorePort, IdempotencyResult } from '../ports/idempotency-store.port';
import { db } from '@/storage/database/mysql-client';
import { idempotencyKeys } from '@/storage/database/shared/schema';
import { eq, and, lt, sql } from 'drizzle-orm';
import * as crypto from 'crypto';

export const IDEMPOTENCY_STORE_TOKEN = 'IdempotencyStorePort';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const LOCK_TTL_MS = 30 * 1000; // 30s 处理锁

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function requestHash(body: unknown): string {
  return sha256(JSON.stringify(body));
}

@Injectable()
export class MysqlIdempotencyStore implements IdempotencyStorePort {
  private readonly logger = new Logger(MysqlIdempotencyStore.name);

  async begin(params: {
    scope: string;
    key: string;
    requestHash: string;
    actorId?: number;
  }): Promise<{ result: IdempotencyResult; cachedResponse?: unknown }> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEFAULT_TTL_MS);
    const lockedUntil = new Date(now.getTime() + LOCK_TTL_MS);

    try {
      await db.insert(idempotencyKeys).values({
        scope: params.scope,
        idempotency_key: params.key,
        actor_user_id: params.actorId ?? null,
        request_hash: params.requestHash,
        status: 'processing',
        locked_until: lockedUntil,
        expires_at: expiresAt,
      });
      return { result: 'started' };
    } catch (err: any) {
      // DUPLICATE ENTRY → 已有记录
      if (err?.code === 'ER_DUP_ENTRY') {
        const existing = await db.select()
          .from(idempotencyKeys)
          .where(and(
            eq(idempotencyKeys.scope, params.scope),
            eq(idempotencyKeys.idempotency_key, params.key),
          ))
          .limit(1);

        const row = existing[0];
        if (!row) return { result: 'started' }; // 并发删除边缘情况

        // 成功 → 返回缓存响应
        if (row.status === 'success') {
          return { result: 'replay', cachedResponse: row.response_json ?? undefined };
        }

        // 处理中但在锁定期内 → 冲突
        if (row.status === 'processing' && row.locked_until && new Date(row.locked_until) > now) {
          return { result: 'conflict' };
        }

        // 内容不同的重试 → 冲突
        if (row.request_hash !== params.requestHash) {
          return { result: 'conflict' };
        }

        // 处理中超时或失败 → 可重试，重置为 processing
        await db.update(idempotencyKeys).set({
          status: 'processing',
          request_hash: params.requestHash,
          locked_until: lockedUntil,
          expires_at: expiresAt,
        }).where(eq(idempotencyKeys.id, row.id));

        return { result: 'started' };
      }

      throw err;
    }
  }

  async complete(params: {
    scope: string;
    key: string;
    response: unknown;
  }): Promise<void> {
    await db.update(idempotencyKeys).set({
      status: 'success',
      response_json: JSON.parse(JSON.stringify(params.response ?? {})),
      locked_until: null,
    }).where(and(
      eq(idempotencyKeys.scope, params.scope),
      eq(idempotencyKeys.idempotency_key, params.key),
    ));
  }

  async fail(params: {
    scope: string;
    key: string;
    reason: string;
  }): Promise<void> {
    await db.update(idempotencyKeys).set({
      status: 'failed',
      locked_until: null,
    }).where(and(
      eq(idempotencyKeys.scope, params.scope),
      eq(idempotencyKeys.idempotency_key, params.key),
    ));
  }

  /** 清理过期记录（由定时任务调用） */
  async recycle(): Promise<number> {
    const result = await db.delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expires_at, new Date()));
    return (result as any)?.[0]?.affectedRows ?? 0;
  }
}
