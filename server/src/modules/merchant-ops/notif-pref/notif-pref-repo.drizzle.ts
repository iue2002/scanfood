import { Injectable } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { user_preferences } from '@/storage/database/shared/schema';
import { eq, sql } from 'drizzle-orm';
import type { NotifPrefRepoPort } from './notif-pref-repo.port';
import type { DesktopEvent, NotifPrefDto, NotifPrefRow } from './notif-pref.types';

@Injectable()
export class DrizzleNotifPrefRepo implements NotifPrefRepoPort {
  private mapRow(r: any): NotifPrefRow {
    let events: DesktopEvent[] = [];
    const raw = r.desktop_events;
    if (Array.isArray(raw)) {
      events = raw as DesktopEvent[];
    } else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) events = parsed as DesktopEvent[];
      } catch {
        events = [];
      }
    }
    return {
      user_id: r.user_id,
      sound_enabled: !!r.sound_enabled,
      sound_id: r.sound_id ?? 'default',
      desktop_events: events,
      updated_at: r.updated_at,
    };
  }

  async getByUserId(userId: number): Promise<NotifPrefRow | null> {
    const rows = await db.select().from(user_preferences).where(eq(user_preferences.user_id, userId)).limit(1);
    if (rows.length === 0) return null;
    return this.mapRow(rows[0]);
  }

  async upsert(userId: number, dto: NotifPrefDto): Promise<NotifPrefRow> {
    // MySQL ON DUPLICATE KEY UPDATE 实现 upsert
    await db
      .insert(user_preferences)
      .values({
        user_id: userId,
        sound_enabled: dto.sound_enabled,
        sound_id: dto.sound_id,
        desktop_events: dto.desktop_events as any,
      })
      .onDuplicateKeyUpdate({
        set: {
          sound_enabled: dto.sound_enabled,
          sound_id: dto.sound_id,
          desktop_events: dto.desktop_events as any,
          // updated_at 由列默认 ON UPDATE CURRENT_TIMESTAMP 自动维护
          updated_at: sql`CURRENT_TIMESTAMP`,
        },
      });
    const row = await this.getByUserId(userId);
    if (!row) {
      // 理论不可能：刚 upsert 完应能查到
      throw new Error('upsert succeeded but row not found');
    }
    return row;
  }
}
