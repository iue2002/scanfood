export type TemplateChannel = 'dingtalk' | 'wecom' | 'feishu' | 'email';
export type TemplateEvent = 'NEW_ORDER' | 'ADD_ITEM' | 'REFUND';

export const ALL_TEMPLATE_EVENTS: ReadonlyArray<TemplateEvent> = ['NEW_ORDER', 'ADD_ITEM', 'REFUND'];
export const ALL_TEMPLATE_CHANNELS: ReadonlyArray<TemplateChannel> = ['dingtalk', 'wecom', 'feishu', 'email'];

export interface NotifTemplateRow {
  id: number;
  event_type: TemplateEvent;
  channel: TemplateChannel;
  title_template: string;
  body_template: string;
  html_template: string | null;
  updated_at: Date;
  updated_by: number;
}

export interface NotifTemplateDto {
  event_type: TemplateEvent;
  channel: TemplateChannel;
  title_template: string;
  body_template: string;
  html_template?: string | null;
}

export interface TemplateVariable {
  name: string;
  description: string;
  scope: 'all' | 'email';
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { name: 'storeName', description: '店铺名称', scope: 'all' },
  { name: 'tableLabel', description: '桌台（如"5号桌"或"外带"）', scope: 'all' },
  { name: 'orderNumber', description: '订单号', scope: 'all' },
  { name: 'totalAmount', description: '订单总额', scope: 'all' },
  { name: 'createdAt', description: '下单时间', scope: 'all' },
  { name: 'itemsSummary', description: '菜品列表（预格式化多行文本）', scope: 'all' },
  { name: 'detailUrl', description: '订单详情链接', scope: 'all' },
  { name: 'eventLabel', description: '事件标签（新订单/加菜通知/退款申请）', scope: 'all' },
  { name: 'recipientName', description: '收件人姓名', scope: 'email' },
];

export interface TemplateRenderResult {
  title: string;
  body: string;
  html: string | null;
}
