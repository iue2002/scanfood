import { Injectable } from '@nestjs/common';
import type { NotifTemplateRepoPort } from './notif-template.repo.port';
import type { NotifTemplateRow, NotifTemplateDto, TemplateEvent, TemplateChannel, TemplateRenderResult } from './notif-template.types';
import { DEFAULT_TEMPLATES } from './notif-template.defaults';

export interface TemplateContext {
  [key: string]: string | undefined;
  storeName: string;
  tableLabel: string;
  orderNumber: string;
  totalAmount: string;
  createdAt: string;
  itemsSummary: string;
  detailUrl: string;
  eventLabel: string;
  recipientName?: string;
}

@Injectable()
export class NotifTemplateCore {
  constructor(private readonly repo: NotifTemplateRepoPort) {}

  /** 在多个通道中找第一个有自定义模板的，找不到返回第一个 */
  async resolveChannel(event: TemplateEvent, channels: TemplateChannel[]): Promise<TemplateChannel> {
    for (const ch of channels) {
      const tpl = await this.repo.findByEventAndChannel(event, ch);
      if (tpl) return ch;
    }
    return channels[0];
  }

  /** 优先用主事件模板；若无则尝试回退事件模板；都无则用主事件默认 */
  async resolveEvent(
    event: TemplateEvent,
    fallback: TemplateEvent,
    channel: TemplateChannel,
  ): Promise<TemplateEvent> {
    if (await this.repo.findByEventAndChannel(event, channel)) return event;
    if (await this.repo.findByEventAndChannel(fallback, channel)) return fallback;
    return event;
  }

  async render(event: TemplateEvent, channel: TemplateChannel, ctx: TemplateContext): Promise<TemplateRenderResult> {
    const dbTemplate = await this.repo.findByEventAndChannel(event, channel);
    const defaults = dbTemplate
      ? { title_template: dbTemplate.title_template, body_template: dbTemplate.body_template, html_template: dbTemplate.html_template }
      : DEFAULT_TEMPLATES[event][channel];

    return {
      title: this.interpolate(defaults.title_template, ctx),
      body: this.interpolate(defaults.body_template, ctx),
      html: defaults.html_template ? this.interpolate(defaults.html_template, ctx) : null,
    };
  }

  interpolate(template: string, ctx: Record<string, string | undefined>): string {
    let result = template;
    for (const [key, value] of Object.entries(ctx)) {
      if (value !== undefined) {
        result = result.split(`{{${key}}}`).join(value);
      }
    }
    return result;
  }

  async upsert(dto: NotifTemplateDto, updatedBy: number): Promise<NotifTemplateRow> {
    return this.repo.upsert(dto, updatedBy);
  }

  async delete(event: TemplateEvent, channel: TemplateChannel): Promise<boolean> {
    return this.repo.delete(event, channel);
  }

  async listAll(): Promise<NotifTemplateRow[]> {
    return this.repo.listAll();
  }
}
