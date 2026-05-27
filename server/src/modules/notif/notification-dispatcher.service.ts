/**
 * 多通道通知调度器（fan-out）
 *
 * 职责：
 *   - 接收订单事件（NEW_ORDER / ADD_ITEM / REFUND）
 *   - 查询所有店铺侧用户（owner / manager / cashier / waiter / admin）
 *   - 按每个用户 user_preferences 分别决定走 push / email
 *   - 推 push（PushNotificationService.sendToUsers）
 *   - 发 email（EmailNotificationService.sendOrderEmail）
 *
 * 红线（来自 AGENTS.md / spec）：
 *   - fire-and-forget：永远不阻塞订单主流程
 *   - 内部任何异常都要吞掉，不冒泡
 *   - 已订阅 push 的设备，每个设备收到一条；email 按 user_preferences.email
 */
import { Injectable, Logger } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import {
  users,
  user_preferences,
  orders,
  order_items,
  tables,
  store_settings,
} from '@/storage/database/shared/schema';
import { eq, inArray } from 'drizzle-orm';
import { PushNotificationService } from './push.service';
import { EmailNotificationService } from './email.service';
import { RobotNotificationService } from './robot.service';
import { NotifTemplateCore } from './notif-template/notif-template.core';
import type { TemplateEvent, TemplateChannel } from './notif-template/notif-template.types';

export type NotifEvent = 'NEW_ORDER' | 'ADD_ITEM' | 'REFUND';

const ADMIN_ROLES = ['owner', 'manager', 'cashier', 'waiter', 'admin'];

interface OrderContext {
  orderId: number;
  orderNumber: string;
  tableLabel: string;
  totalAmount: string;
  items: Array<{ name: string; quantity: number; subtotal: string }>;
  createdAt: string;
}

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly pushService: PushNotificationService,
    private readonly emailService: EmailNotificationService,
    private readonly robotService: RobotNotificationService,
    private readonly templateCore: NotifTemplateCore,
  ) {}

  /**
   * 入口：触发一个订单事件的多通道通知
   * 调用方在 try/catch 外用 `void this.dispatcher.notifyOrderEvent(...)`，无需 await。
   */
  async notifyOrderEvent(event: NotifEvent, orderId: number): Promise<void> {
    try {
      const ctx = await this.loadOrderContext(orderId, event);
      if (!ctx) return;

      // 拉所有有效员工 + 偏好
      const staff = await this.loadStaffPreferences();

      // 三通道并发 fan-out（彼此独立，单通道失败不影响其它）
      await Promise.allSettled([
        this.dispatchPush(event, ctx, staff),
        this.dispatchEmail(event, ctx, staff),
        this.dispatchRobot(event, ctx),
      ]);
    } catch (err) {
      // 顶层吞错，保护订单主流程
      this.logger.error(`[notif] dispatch event=${event} orderId=${orderId} 失败（吞掉）: ${(err as Error).message}`);
    }
  }

  // ============================================================
  // 群机器人分发（钉钉 / 企微 / 飞书）
  // ============================================================

  private async dispatchRobot(event: NotifEvent, ctx: OrderContext): Promise<void> {
    try {
      const storeName = await this.getStoreName();
      const detailUrl = this.buildDetailUrl(ctx.orderId);
      const eventLabel = { NEW_ORDER: '新订单', ADD_ITEM: '加菜通知', REFUND: '退款申请' }[event];
      const itemsSummary = this.buildItemsSummary(ctx.items);

      // 机器人通道共享模板：任意通道有自定义模板就使用
      const robotChannels: TemplateChannel[] = ['dingtalk', 'wecom', 'feishu'];
      const channel = await this.templateCore.resolveChannel(event as TemplateEvent, robotChannels);
      // 加餐/退款未设模板时回退到新订单模板
      const templateEvent = (event === 'ADD_ITEM' || event === 'REFUND')
        ? await this.templateCore.resolveEvent(event as TemplateEvent, 'NEW_ORDER', channel)
        : event as TemplateEvent;
      const rendered = await this.templateCore.render(templateEvent, channel, {
        storeName,
        tableLabel: ctx.tableLabel,
        orderNumber: ctx.orderNumber,
        totalAmount: ctx.totalAmount,
        createdAt: ctx.createdAt,
        itemsSummary,
        detailUrl: detailUrl || '',
        eventLabel,
      });
      await this.robotService.sendForEvent(event, { title: rendered.title, markdown: rendered.body, url: detailUrl }, 1);
    } catch (err) {
      this.logger.warn(`[notif] robot dispatch error (吞掉): ${(err as Error).message}`);
    }
  }

  private buildItemsSummary(items: OrderContext['items']): string {
    if (items.length === 0) return '（无菜品）';
    return items
      .slice(0, 10)
      .map((i) => `- ${i.name} × **${i.quantity}** ¥${i.subtotal}`)
      .join('\n') + (items.length > 10 ? `\n... 共 ${items.length} 项` : '');
  }

  // ============================================================
  // Push 分发
  // ============================================================

  private async dispatchPush(
    event: NotifEvent,
    ctx: OrderContext,
    staff: StaffPref[],
  ): Promise<void> {
    if (!this.pushService.isEnabled()) return;
    try {
      const recipients = staff.filter((s) => s.desktop_events.includes(event));
      if (recipients.length === 0) return;

      const userIds = recipients.map((s) => s.userId);
      const title = this.buildTitle(event, ctx);
      const body = this.buildPushBody(event, ctx);
      const url = `/orders?focus=${ctx.orderId}`;
      const tag = `${event}-${ctx.orderId}`;

      // sendToUsers 内部按 push_subscriptions 表查订阅；没订阅的员工自动跳过
      await this.pushService.sendToUsers(userIds, { title, body, url, tag });
    } catch (err) {
      this.logger.warn(`[notif] push dispatch error (吞掉): ${(err as Error).message}`);
    }
  }

  // ============================================================
  // Email 分发
  // ============================================================

  private async dispatchEmail(
    event: NotifEvent,
    ctx: OrderContext,
    staff: StaffPref[],
  ): Promise<void> {
    try {
      const recipients = staff.filter(
        (s) =>
          s.email && s.email.length > 0 && s.email_events.includes(event),
      );
      if (recipients.length === 0) return;

      // 是否有可用 SMTP（避免无意义循环）
      const available = await this.emailService.isAvailable();
      if (!available) {
        this.logger.warn(`[notif] email skipped: no SMTP configured (platform/custom)`);
        return;
      }

      const storeName = await this.getStoreName();
      const detailUrl = this.buildDetailUrl(ctx.orderId);

      // 并发发，单封内部由 EmailService 限流 + 超时控制
      const results = await Promise.allSettled(
        recipients.map((r) =>
          this.emailService.sendOrderEmail({
            to: r.email!,
            storeName,
            recipientName: r.username,
            orderNumber: ctx.orderNumber,
            tableLabel: ctx.tableLabel,
            totalAmount: ctx.totalAmount,
            items: ctx.items,
            createdAt: ctx.createdAt,
            detailUrl,
            event,
          }),
        ),
      );
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled' && !r.value.ok) {
          this.logger.warn(`[notif] email to ${recipients[idx].email} skipped: ${r.value.reason}`);
        } else if (r.status === 'rejected') {
          this.logger.warn(`[notif] email to ${recipients[idx].email} rejected: ${(r.reason as Error)?.message?.slice(0, 100)}`);
        }
      });
    } catch (err) {
      this.logger.warn(`[notif] email dispatch error (吞掉): ${(err as Error).message}`);
    }
  }

  // ============================================================
  // 上下文准备
  // ============================================================

  private async loadOrderContext(orderId: number, event?: NotifEvent): Promise<OrderContext | null> {
    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (orderRows.length === 0) return null;
    const order = orderRows[0] as any;

    let items = await db
      .select()
      .from(order_items)
      .where(eq(order_items.order_id, orderId));

    // 加餐通知只带最新一轮的菜品，不重复展示整单
    if (event === 'ADD_ITEM' && items.length > 0) {
      const maxRound = Math.max(...items.map((i: any) => i.add_more_round ?? 0));
      items = items.filter((i: any) => (i.add_more_round ?? 0) === maxRound);
    }

    const tableRows = await db
      .select()
      .from(tables)
      .where(eq(tables.id, order.table_id))
      .limit(1);
    const table = tableRows[0] as any;
    const isTakeaway =
      order.order_type === 'takeaway' || table?.table_number === '__TAKEAWAY__';
    const pickupNo = order.pickup_no as number | null | undefined;
    const tableLabel = isTakeaway
      ? (pickupNo ? `外带 ${pickupNo}号` : '外带')
      : `${table?.table_number || '?'} 号桌`;

    return {
      orderId: order.id,
      orderNumber: order.order_number,
      tableLabel,
      totalAmount: String(order.total_amount ?? '0.00'),
      items: items.map((i: any) => ({
        name: this.composeItemName(i.dish_name, i.spec_name),
        quantity: i.quantity,
        subtotal: String(i.subtotal ?? '0.00'),
      })),
      createdAt: this.formatDate(order.created_at),
    };
  }

  private composeItemName(dishName: string, specName?: string | null): string {
    if (specName && specName.trim()) return `${dishName}（${specName}）`;
    return dishName;
  }

  private async loadStaffPreferences(): Promise<StaffPref[]> {
    // 1) 拉员工
    const staff = await db
      .select({
        id: users.id,
        username: users.nickname,
        role: users.role,
      })
      .from(users)
      .where(inArray(users.role, ADMIN_ROLES));
    if (staff.length === 0) return [];

    // 2) 拉偏好
    const ids = staff.map((s) => s.id);
    const prefs = await db
      .select()
      .from(user_preferences)
      .where(inArray(user_preferences.user_id, ids));
    const prefMap = new Map<number, any>();
    for (const p of prefs) prefMap.set((p as any).user_id, p);

    return staff.map((s) => {
      const p = prefMap.get(s.id);
      return {
        userId: s.id,
        username: s.username || `user-${s.id}`,
        role: s.role,
        desktop_events: parseEventArray(p?.desktop_events) || ['NEW_ORDER'],
        email: typeof p?.email === 'string' && p.email.length > 0 ? p.email : null,
        email_events: parseEventArray(p?.email_events) || [],
      };
    });
  }

  private async getStoreName(): Promise<string> {
    try {
      const rows = await db.select({ name: store_settings.store_name }).from(store_settings).limit(1);
      return rows[0]?.name || '我的小店';
    } catch {
      return '我的小店';
    }
  }

  // ============================================================
  // 文本模板
  // ============================================================

  private buildTitle(event: NotifEvent, ctx: OrderContext): string {
    const label = { NEW_ORDER: '🛎 新订单', ADD_ITEM: '🍽 加餐', REFUND: '💸 退款申请' }[event];
    return `${label}・${ctx.tableLabel}`;
  }

  private buildPushBody(event: NotifEvent, ctx: OrderContext): string {
    const itemSummary = ctx.items
      .slice(0, 3)
      .map((i) => `${i.name}×${i.quantity}`)
      .join('、');
    const more = ctx.items.length > 3 ? ` 等${ctx.items.length}项` : '';
    return `¥${ctx.totalAmount}　${itemSummary}${more}`;
  }

  private buildDetailUrl(orderId: number): string | undefined {
    const baseUrl = process.env.ADMIN_WEB_BASE_URL;
    if (!baseUrl) return undefined;
    const trimmed = baseUrl.replace(/\/$/, '');
    return `${trimmed}/orders?focus=${orderId}`;
  }

  private formatDate(d: Date | string | null | undefined): string {
    if (!d) return '';
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime())) return String(d);
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
}

interface StaffPref {
  userId: number;
  username: string;
  role: string;
  desktop_events: NotifEvent[];
  email: string | null;
  email_events: NotifEvent[];
}

function parseEventArray(raw: any): NotifEvent[] | null {
  if (Array.isArray(raw)) {
    return raw.filter((e): e is NotifEvent =>
      e === 'NEW_ORDER' || e === 'ADD_ITEM' || e === 'REFUND',
    );
  }
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((e): e is NotifEvent =>
          e === 'NEW_ORDER' || e === 'ADD_ITEM' || e === 'REFUND',
        );
      }
    } catch {
      return null;
    }
  }
  return null;
}
