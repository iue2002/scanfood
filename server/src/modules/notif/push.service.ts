/**
 * Web Push 推送服务
 *
 * 标准 Web Push 协议实现：
 *   - VAPID 密钥对在启动时从 .env 读取（缺失则禁用 push 功能）
 *   - 给所有/指定用户的有效订阅发推送
 *   - 失败处理：
 *     - 404/410（subscription expired）→ 立即从 DB 删除该订阅
 *     - 其他错误 → failed_count++，连续 5 次失败后删除
 *   - fire-and-forget：永远不阻塞订单主流程（红线）
 *
 * 推送通道：
 *   - Edge → WNS（Microsoft 推送中心，国内节点稳定）
 *   - Chrome / Firefox → FCM / Mozilla（国内偶尔不通）
 *   - Safari ≥ 16.4 PWA → APNs（苹果推送中心，国内稳）
 */
import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { db } from '@/storage/database/mysql-client';
import { push_subscriptions, users } from '@/storage/database/shared/schema';
import { eq, inArray, and } from 'drizzle-orm';

export interface WebPushPayload {
  title: string;
  body: string;
  /** 点击通知后跳转的 URL（相对路径，如 /orders?focus=123） */
  url?: string;
  /** 通知 tag，相同 tag 会合并/替换 */
  tag?: string;
  /** 通知图标（默认走前端 SW 里的 /icon-192.png） */
  icon?: string;
}

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private vapidConfigured = false;

  constructor() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:admin@scanfood.local';

    if (publicKey && privateKey) {
      try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        this.vapidConfigured = true;
        this.logger.log('[push] VAPID configured, web push enabled');
      } catch (err) {
        this.logger.error(`[push] VAPID configuration failed: ${(err as Error).message}`);
      }
    } else {
      this.logger.warn('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY missing in .env, web push disabled');
    }
  }

  isEnabled(): boolean {
    return this.vapidConfigured;
  }

  getPublicKey(): string {
    return process.env.VAPID_PUBLIC_KEY || '';
  }

  /**
   * 注册（或更新）一个订阅
   * 同一 endpoint 视为同一订阅，重复调用会更新 user_agent / 重置 failed_count
   */
  async subscribe(input: {
    userId: number;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
  }): Promise<{ id: number }> {
    // endpoint 唯一索引：先查存在则更新
    const existing = await db
      .select({ id: push_subscriptions.id })
      .from(push_subscriptions)
      .where(eq(push_subscriptions.endpoint, input.endpoint))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(push_subscriptions)
        .set({
          user_id: input.userId,
          p256dh: input.p256dh,
          auth: input.auth,
          user_agent: input.userAgent || null,
          failed_count: 0,
        })
        .where(eq(push_subscriptions.id, existing[0].id));
      this.logger.log(`[push] subscription updated for user=${input.userId}, id=${existing[0].id}`);
      return { id: existing[0].id };
    }

    const result = await db.insert(push_subscriptions).values({
      user_id: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      user_agent: input.userAgent || null,
      failed_count: 0,
    });
    const newId = (result as any)[0].insertId;
    this.logger.log(`[push] new subscription user=${input.userId}, id=${newId}, ua=${input.userAgent?.slice(0, 60)}`);
    return { id: newId };
  }

  /**
   * 取消某个订阅（用户主动关闭）
   */
  async unsubscribe(userId: number, endpoint: string): Promise<{ removed: number }> {
    const r = await db
      .delete(push_subscriptions)
      .where(
        and(
          eq(push_subscriptions.user_id, userId),
          eq(push_subscriptions.endpoint, endpoint),
        ),
      );
    const affected = (r as any)?.[0]?.affectedRows ?? 0;
    this.logger.log(`[push] unsubscribe user=${userId} affected=${affected}`);
    return { removed: affected };
  }

  /**
   * 列出某用户的全部订阅（用于 UI 展示"哪些设备订阅了"）
   */
  async listByUser(userId: number) {
    return db
      .select({
        id: push_subscriptions.id,
        endpoint: push_subscriptions.endpoint,
        user_agent: push_subscriptions.user_agent,
        created_at: push_subscriptions.created_at,
        last_used_at: push_subscriptions.last_used_at,
        failed_count: push_subscriptions.failed_count,
      })
      .from(push_subscriptions)
      .where(eq(push_subscriptions.user_id, userId));
  }

  /**
   * 给指定用户列表的所有订阅推送
   * 失败处理：fire-and-forget，永远不抛错
   */
  async sendToUsers(userIds: number[], payload: WebPushPayload): Promise<void> {
    if (!this.vapidConfigured || userIds.length === 0) return;
    try {
      const subs = await db
        .select()
        .from(push_subscriptions)
        .where(inArray(push_subscriptions.user_id, userIds));

      if (subs.length === 0) return;

      const json = JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url || '/',
        tag: payload.tag,
        icon: payload.icon,
      });

      // 并发推（每个失败独立处理）
      await Promise.allSettled(
        subs.map(async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              json,
              { TTL: 60 }, // 60s 内送达，超时视为过期
            );
            // 成功：更新 last_used_at + 重置失败计数
            await db
              .update(push_subscriptions)
              .set({ last_used_at: new Date(), failed_count: 0 })
              .where(eq(push_subscriptions.id, sub.id))
              .catch(() => { /* fire-and-forget */ });
          } catch (err: any) {
            const statusCode = err?.statusCode || 0;
            // 410 Gone / 404 Not Found：订阅已失效，立即清理
            if (statusCode === 410 || statusCode === 404) {
              this.logger.warn(`[push] subscription expired (${statusCode}), removing id=${sub.id}`);
              await db
                .delete(push_subscriptions)
                .where(eq(push_subscriptions.id, sub.id))
                .catch(() => { /* ignore */ });
              return;
            }
            // 其他错误：累加失败计数，超 5 次清理
            const newFailedCount = sub.failed_count + 1;
            if (newFailedCount >= 5) {
              this.logger.warn(`[push] removing sub id=${sub.id} after 5 consecutive failures`);
              await db
                .delete(push_subscriptions)
                .where(eq(push_subscriptions.id, sub.id))
                .catch(() => { /* ignore */ });
            } else {
              await db
                .update(push_subscriptions)
                .set({ failed_count: newFailedCount })
                .where(eq(push_subscriptions.id, sub.id))
                .catch(() => { /* ignore */ });
            }
            this.logger.warn(
              `[push] send failed sub=${sub.id} status=${statusCode} attempt=${newFailedCount}/5: ${err?.message?.slice(0, 100)}`,
            );
          }
        }),
      );
    } catch (err) {
      // 顶层吞错，绝不冒泡到订单主流程
      this.logger.error(`[push] sendToUsers error (吞掉): ${(err as Error).message}`);
    }
  }

  /**
   * 给所有 admin 角色（owner/manager/cashier/waiter/admin）的订阅发推送
   */
  async sendToAllAdmins(payload: WebPushPayload): Promise<void> {
    if (!this.vapidConfigured) return;
    try {
      const adminRoles = ['owner', 'manager', 'cashier', 'waiter', 'admin'];
      const adminUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.role, adminRoles));
      const userIds = adminUsers.map((u) => u.id);
      await this.sendToUsers(userIds, payload);
    } catch (err) {
      this.logger.error(`[push] sendToAllAdmins error (吞掉): ${(err as Error).message}`);
    }
  }
}
