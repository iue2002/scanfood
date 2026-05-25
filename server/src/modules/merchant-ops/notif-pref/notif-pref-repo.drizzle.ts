import { Injectable } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { user_preferences } from '@/storage/database/shared/schema';
import { eq, sql } from 'drizzle-orm';
import type { NotifPrefRepoPort } from './notif-pref-repo.port';
import type { DesktopEvent, EmailEvent, NotifPrefDto, NotifPrefRow } from './notif-pref.types';

@Injectable()
export class DrizzleNotifPrefRepo implements NotifPrefRepoPort {
  private parseEvents(raw: any): DesktopEvent[] {
    if (Array.isArray(raw)) return raw as DesktopEvent[];
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as DesktopEvent[];
      } catch {
        return [];
      }
    }
    return [];
  }

  private mapRow(r: any): NotifPrefRow {
    const email = typeof r.email === 'string' && r.email.length > 0 ? r.email : null;
    return {
      user_id: r.user_id,
      sound_enabled: !!r.sound_enabled,
      sound_id: r.sound_id ?? 'default',
      desktop_events: this.parseEvents(r.desktop_events),
      email,
      email_events: this.parseEvents(r.email_events) as EmailEvent[],
      updated_at: r.updated_at,
    };
  }

  async getByUserId(userId: number): Promise<NotifPrefRow | null> {
    const rows = await db.select().from(user_preferences).where(eq(user_preferences.user_id, userId)).limit(1);
    if (rows.length === 0) return null;
    return this.mapRow(rows[0]);
  }

  async upsert(userId: number, dto: NotifPrefDto): Promise<NotifPrefRow> {
    // 读取旧值（部分更新场景：dto 中未传 email/email_events 时保留旧值）
    const existing = await this.getByUserId(userId);

    const finalEmail =
      dto.email === undefined ? existing?.email ?? null : dto.email;
    const finalEmailEvents =
      dto.email_events === undefined
        ? (existing?.email_events ?? [])
        : dto.email_events;

    // MySQL ON DUPLICATE KEY UPDATE 实现 upsert
    const valuesPayload: any = {
      user_id: userId,
      sound_enabled: dto.sound_enabled,
      sound_id: dto.sound_id,
      desktop_events: dto.desktop_events as any,
      email: finalEmail,
      email_events: finalEmailEvents as any,
    };

    await db
      .insert(user_preferences)
      .values(valuesPayload)
      .onDuplicateKeyUpdate({
        set: {
          sound_enabled: dto.sound_enabled,
          sound_id: dto.sound_id,
          desktop_events: dto.desktop_events as any,
          email: finalEmail,
          email_events: finalEmailEvents as any,
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
