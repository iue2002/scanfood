import { Injectable } from '@nestjs/common';
import type { NotifTemplateRepoPort } from './notif-template.repo.port';
import type { NotifTemplateRow, NotifTemplateDto, TemplateEvent, TemplateChannel, TemplateRenderResult, TemplatePreviewResult } from './notif-template.types';
import { DEFAULT_TEMPLATES } from './notif-template.defaults';
import { TEMPLATE_VARIABLES } from './notif-template.types';

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

const TEMPLATE_VAR_RE = /{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g;

const SAMPLE_CONTEXT: TemplateContext = {
  storeName: '阿来小馆',
  tableLabel: '5号桌',
  orderNumber: 'A20260601001',
  totalAmount: '128.00',
  createdAt: '2026-06-01 18:30',
  itemsSummary: '宫保鸡丁 x1\n米饭 x2\n鲜榨橙汁 x1',
  detailUrl: 'https://www.ali88.online/admin/orders/A20260601001',
  eventLabel: '新订单',
  recipientName: '店长',
};

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
    const resolved = await this.resolveTemplate(event, channel);

    return {
      title: this.interpolate(resolved.template.title_template, ctx),
      body: this.interpolate(resolved.template.body_template, ctx),
      html: resolved.template.html_template ? this.interpolate(resolved.template.html_template, ctx) : null,
    };
  }

  async preview(
    event: TemplateEvent,
    channel: TemplateChannel,
    draft?: Partial<NotifTemplateDto>,
    allowedVariables?: string[],
  ): Promise<TemplatePreviewResult> {
    const resolved = await this.resolveTemplate(event, channel);
    const template: NotifTemplateDto = {
      event_type: event,
      channel,
      title_template: draft?.title_template ?? resolved.template.title_template,
      body_template: draft?.body_template ?? resolved.template.body_template,
      html_template: draft?.html_template === undefined ? resolved.template.html_template : draft.html_template,
    };
    const allowed = new Set(allowedVariables?.length ? allowedVariables : TEMPLATE_VARIABLES.map((v) => v.name));

    return {
      source: draft ? 'custom' : resolved.source,
      template,
      rendered: {
        title: this.interpolate(template.title_template, SAMPLE_CONTEXT),
        body: this.interpolate(template.body_template, SAMPLE_CONTEXT),
        html: template.html_template ? this.interpolate(template.html_template, SAMPLE_CONTEXT) : null,
      },
      unknownVariables: this.collectUnknownVariables(template, allowed),
    };
  }

  async getDefaults(): Promise<Record<TemplateEvent, Record<TemplateChannel, NotifTemplateDto>>> {
    const out = {} as Record<TemplateEvent, Record<TemplateChannel, NotifTemplateDto>>;
    for (const event of Object.keys(DEFAULT_TEMPLATES) as TemplateEvent[]) {
      out[event] = {} as Record<TemplateChannel, NotifTemplateDto>;
      for (const channel of Object.keys(DEFAULT_TEMPLATES[event]) as TemplateChannel[]) {
        out[event][channel] = { event_type: event, channel, ...DEFAULT_TEMPLATES[event][channel] };
      }
    }
    return out;
  }

  interpolate(template: string, ctx: Record<string, string | undefined>): string {
    return template.replace(TEMPLATE_VAR_RE, (full, key: string) => {
      const value = ctx[key];
      return value === undefined ? full : value;
    });
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

  private async resolveTemplate(event: TemplateEvent, channel: TemplateChannel): Promise<{ source: 'custom' | 'default'; template: NotifTemplateDto }> {
    const dbTemplate = await this.repo.findByEventAndChannel(event, channel);
    if (dbTemplate) {
      return { source: 'custom', template: dbTemplate };
    }
    return {
      source: 'default',
      template: { event_type: event, channel, ...DEFAULT_TEMPLATES[event][channel] },
    };
  }

  private collectUnknownVariables(template: NotifTemplateDto, allowed: Set<string>): string[] {
    const found = new Set<string>();
    const scan = (value?: string | null) => {
      if (!value) return;
      for (const match of value.matchAll(TEMPLATE_VAR_RE)) {
        const name = match[1];
        if (!allowed.has(name)) found.add(name);
      }
    };
    scan(template.title_template);
    scan(template.body_template);
    scan(template.html_template);
    return Array.from(found).sort();
  }
}
