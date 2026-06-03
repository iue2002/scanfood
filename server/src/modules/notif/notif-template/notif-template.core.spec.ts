import { describe, expect, it } from 'vitest';
import { NotifTemplateCore } from './notif-template.core';
import type { NotifTemplateDto, NotifTemplateRow, TemplateChannel, TemplateEvent } from './notif-template.types';
import type { NotifTemplateRepoPort } from './notif-template.repo.port';

class MemoryRepo implements NotifTemplateRepoPort {
  private rows = new Map<string, NotifTemplateRow>();

  constructor(seed: NotifTemplateRow[] = []) {
    for (const row of seed) this.rows.set(`${row.event_type}|${row.channel}`, row);
  }

  async findByEventAndChannel(event: TemplateEvent, channel: TemplateChannel): Promise<NotifTemplateRow | null> {
    return this.rows.get(`${event}|${channel}`) ?? null;
  }

  async upsert(dto: NotifTemplateDto, updatedBy: number): Promise<NotifTemplateRow> {
    const row: NotifTemplateRow = {
      id: this.rows.size + 1,
      event_type: dto.event_type,
      channel: dto.channel,
      title_template: dto.title_template,
      body_template: dto.body_template,
      html_template: dto.html_template ?? null,
      updated_at: new Date(),
      updated_by: updatedBy,
    };
    this.rows.set(`${dto.event_type}|${dto.channel}`, row);
    return row;
  }

  async delete(event: TemplateEvent, channel: TemplateChannel): Promise<boolean> {
    this.rows.delete(`${event}|${channel}`);
    return true;
  }

  async listAll(): Promise<NotifTemplateRow[]> {
    return Array.from(this.rows.values());
  }
}

describe('NotifTemplateCore', () => {
  it('previews draft templates and reports unknown variables', async () => {
    const core = new NotifTemplateCore(new MemoryRepo());

    const preview = await core.preview('NEW_ORDER', 'dingtalk', {
      title_template: '新订单 {{ tableLabel }} {{badName}}',
      body_template: '订单 {{orderNumber}} 已收到',
      html_template: null,
    }, ['tableLabel', 'orderNumber']);

    expect(preview.rendered.title).toContain('5号桌');
    expect(preview.rendered.body).toContain('A20260601001');
    expect(preview.unknownVariables).toEqual(['badName']);
  });

  it('returns defaults with event and channel metadata', async () => {
    const core = new NotifTemplateCore(new MemoryRepo());

    const defaults = await core.getDefaults();

    expect(defaults.NEW_ORDER.dingtalk.event_type).toBe('NEW_ORDER');
    expect(defaults.NEW_ORDER.dingtalk.channel).toBe('dingtalk');
    expect(defaults.NEW_ORDER.dingtalk.title_template).toContain('{{tableLabel}}');
  });
});
