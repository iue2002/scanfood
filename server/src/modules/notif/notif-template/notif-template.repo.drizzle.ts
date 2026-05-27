import { Injectable } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { notification_templates } from '@/storage/database/shared/schema';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { NotifTemplateRepoPort } from './notif-template.repo.port';
import type { NotifTemplateRow, NotifTemplateDto, TemplateEvent, TemplateChannel } from './notif-template.types';

@Injectable()
export class DrizzleNotifTemplateRepo implements NotifTemplateRepoPort {
  async findByEventAndChannel(event: TemplateEvent, channel: TemplateChannel): Promise<NotifTemplateRow | null> {
    const rows = await db
      .select()
      .from(notification_templates)
      .where(and(
        eq(notification_templates.event_type, event),
        eq(notification_templates.channel, channel),
      ))
      .limit(1);
    return rows.length === 0 ? null : (rows[0] as NotifTemplateRow);
  }

  async upsert(dto: NotifTemplateDto, updatedBy: number): Promise<NotifTemplateRow> {
    await db
      .insert(notification_templates)
      .values({
        event_type: dto.event_type,
        channel: dto.channel,
        title_template: dto.title_template,
        body_template: dto.body_template,
        html_template: dto.html_template ?? null,
        updated_by: updatedBy,
      })
      .onDuplicateKeyUpdate({
        set: {
          title_template: dto.title_template,
          body_template: dto.body_template,
          html_template: dto.html_template ?? null,
          updated_by: updatedBy,
          updated_at: sql`CURRENT_TIMESTAMP`,
        },
      });

    const row = await this.findByEventAndChannel(dto.event_type, dto.channel);
    if (!row) throw new Error('upsert succeeded but row not found');
    return row;
  }

  async delete(event: TemplateEvent, channel: TemplateChannel): Promise<boolean> {
    const result = await db
      .delete(notification_templates)
      .where(and(
        eq(notification_templates.event_type, event),
        eq(notification_templates.channel, channel),
      ));
    return true;
  }

  async listAll(): Promise<NotifTemplateRow[]> {
    return (await db.select().from(notification_templates)) as NotifTemplateRow[];
  }
}
