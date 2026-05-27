import type { NotifTemplateRow, NotifTemplateDto, TemplateEvent, TemplateChannel } from './notif-template.types';

export interface NotifTemplateRepoPort {
  findByEventAndChannel(event: TemplateEvent, channel: TemplateChannel): Promise<NotifTemplateRow | null>;
  upsert(dto: NotifTemplateDto, updatedBy: number): Promise<NotifTemplateRow>;
  delete(event: TemplateEvent, channel: TemplateChannel): Promise<boolean>;
  listAll(): Promise<NotifTemplateRow[]>;
}

export const NOTIF_TEMPLATE_REPO_TOKEN = 'NotifTemplateRepoPort';
