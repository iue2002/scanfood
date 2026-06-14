/**
 * MysqlEventOutbox：EventOutboxPort 的 MySQL 实现
 */
import { Injectable, Logger } from '@nestjs/common';
import type { EventOutboxPort, OutboxEvent } from '../ports/event-outbox.port';
import { db } from '@/storage/database/mysql-client';
import { eventOutbox } from '@/storage/database/shared/schema';
import { eq, and, lte, inArray } from 'drizzle-orm';

export const EVENT_OUTBOX_TOKEN = 'EventOutboxPort';

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000]; // 5s → 2min

@Injectable()
export class MysqlEventOutbox implements EventOutboxPort {
  private readonly logger = new Logger(MysqlEventOutbox.name);

  async append(tx: any, event: OutboxEvent): Promise<void> {
    const now = new Date();
    await tx.insert(eventOutbox).values({
      event_type: event.event_type,
      aggregate_type: event.aggregate_type,
      aggregate_id: event.aggregate_id,
      payload_json: JSON.parse(JSON.stringify(event.payload)),
      status: 'pending',
      attempts: 0,
      next_retry_at: now,
    });
  }

  async poll(batchSize: number): Promise<Array<{ id: number } & OutboxEvent>> {
    const now = new Date();
    const rows = await db.select()
      .from(eventOutbox)
      .where(and(
        eq(eventOutbox.status, 'pending'),
        lte(eventOutbox.next_retry_at as any, now),
      ))
      .limit(batchSize)
      .orderBy(eventOutbox.created_at);

    // 标记为 processing
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      await db.update(eventOutbox).set({ status: 'processing' })
        .where(inArray(eventOutbox.id, ids) as any);
    }

    return rows.map((r) => ({
      id: r.id,
      event_type: r.event_type,
      aggregate_type: r.aggregate_type,
      aggregate_id: r.aggregate_id,
      payload: (r.payload_json ?? {}) as Record<string, unknown>,
    }));
  }

  async ack(eventId: number): Promise<void> {
    await db.update(eventOutbox).set({
      status: 'success',
      processed_at: new Date(),
    }).where(eq(eventOutbox.id, eventId));
  }

  async nack(eventId: number, error: string): Promise<void> {
    const rows = await db.select().from(eventOutbox).where(eq(eventOutbox.id, eventId)).limit(1);
    const row = rows[0];
    if (!row) return;

    const newAttempts = (row.attempts ?? 0) + 1;
    const nextStatus = newAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    const retryDelay = RETRY_DELAYS_MS[Math.min(newAttempts - 1, RETRY_DELAYS_MS.length - 1)];
    const nextRetryAt = nextStatus === 'pending' ? new Date(Date.now() + retryDelay) : null;

    await db.update(eventOutbox).set({
      status: nextStatus,
      attempts: newAttempts,
      next_retry_at: nextRetryAt,
      last_error: error.substring(0, 500),
    }).where(eq(eventOutbox.id, eventId));
  }
}
