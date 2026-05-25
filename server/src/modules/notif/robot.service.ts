/**
 * 群机器人通知服务（钉钉 / 企业微信 / 飞书）
 *
 * 设计目标：
 *   - 三家 provider 统一抽象（drivers map），UI 可三选一或同时启用
 *   - webhook URL + secret 经 AES-256-GCM 加密落库（敏感凭证不落明文）
 *   - 钉钉签名：HMAC-SHA256(timestamp + "\n" + secret)，URL 上加 timestamp + sign
 *   - 飞书签名：HMAC-SHA256(timestamp + "\n" + secret)，body 里加 timestamp + sign
 *   - 企微无签名（白名单 IP / 群密钥即认证）
 *   - 限流：钉钉 20/min、企微 20/min、飞书 100/sec — 我们统一卡 20/min/通道，安全的
 *   - 超时：每次 HTTP 10s 硬超时
 *   - 失败处理：连续 N 次失败累计到 failed_count，UI 展示告警
 *   - fire-and-forget：永远不阻塞订单主流程（红线）
 */
import { Injectable, Logger } from '@nestjs/common';
import { db } from '@/storage/database/mysql-client';
import { robot_webhooks } from '@/storage/database/shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { createHmac } from 'crypto';
import { AesEncryptorService } from '../merchant-ops/print/aes-encryptor';

export type RobotProvider = 'dingtalk' | 'wecom' | 'feishu';
export type RobotEvent = 'NEW_ORDER' | 'ADD_ITEM' | 'REFUND';

export const ALL_ROBOT_PROVIDERS: RobotProvider[] = ['dingtalk', 'wecom', 'feishu'];

export interface RobotConfigPublic {
  provider: RobotProvider;
  enabled: boolean;
  /** 是否已设置 webhook（不返回明文/密文） */
  has_webhook: boolean;
  /** 是否已设置签名密钥（钉钉/飞书可选） */
  has_secret: boolean;
  events: RobotEvent[];
  last_sent_at: string | null;
  last_error: string | null;
  failed_count: number;
}

export interface RobotMessage {
  title: string;
  /** Markdown 主体 */
  markdown: string;
  /** 跳转链接（部分 provider 支持卡片链接） */
  url?: string;
}

const HTTP_TIMEOUT_MS = 10_000;
const RATE_LIMIT_PER_PROVIDER_PER_MIN = 20;

@Injectable()
export class RobotNotificationService {
  private readonly logger = new Logger(RobotNotificationService.name);

  // 限流：每个 webhookId 最近 60s 内的发送次数
  private readonly rateLimitMap = new Map<number, number[]>();

  constructor(private readonly aes: AesEncryptorService) {}

  // ============================================================
  // 配置 CRUD
  // ============================================================

  /** 列出当前店铺所有 provider 的配置（脱敏） */
  async listConfigs(storeId = 1): Promise<RobotConfigPublic[]> {
    const rows = await db
      .select()
      .from(robot_webhooks)
      .where(eq(robot_webhooks.store_id, storeId));
    return rows.map((r) => this.toPublicConfig(r as any));
  }

  /** 上行：保存（INSERT or UPDATE）某 provider 的配置 */
  async upsertConfig(input: {
    storeId?: number;
    provider: RobotProvider;
    enabled: boolean;
    webhookUrl?: string; // 明文；未填表示沿用旧值
    secret?: string;     // 明文；未填表示沿用旧值
    events: RobotEvent[];
  }): Promise<RobotConfigPublic> {
    const storeId = input.storeId ?? 1;
    if (!ALL_ROBOT_PROVIDERS.includes(input.provider)) {
      throw new Error(`未知 provider：${input.provider}`);
    }

    // 取既有行（决定是 INSERT 还是 UPDATE）
    const existing = await db
      .select()
      .from(robot_webhooks)
      .where(and(eq(robot_webhooks.store_id, storeId), eq(robot_webhooks.provider, input.provider)))
      .limit(1);

    const events = this.dedupEvents(input.events);

    if (existing.length === 0) {
      // 首次创建必须有 webhookUrl
      if (!input.webhookUrl) {
        throw new Error('首次配置必须填写 webhook URL');
      }
      this.validateWebhookUrl(input.provider, input.webhookUrl);
      await db.insert(robot_webhooks).values({
        store_id: storeId,
        provider: input.provider,
        enabled: input.enabled,
        webhook_url_enc: this.aes.encrypt(input.webhookUrl),
        secret_enc: input.secret ? this.aes.encrypt(input.secret) : null,
        events_json: events as any,
        failed_count: 0,
      });
    } else {
      const updateSet: any = {
        enabled: input.enabled,
        events_json: events,
        // 任何写入都重置失败计数（让用户可以"修一下立刻重试"）
        failed_count: 0,
        last_error: null,
      };
      if (input.webhookUrl) {
        this.validateWebhookUrl(input.provider, input.webhookUrl);
        updateSet.webhook_url_enc = this.aes.encrypt(input.webhookUrl);
      }
      if (input.secret !== undefined) {
        updateSet.secret_enc = input.secret ? this.aes.encrypt(input.secret) : null;
      }
      await db
        .update(robot_webhooks)
        .set(updateSet)
        .where(and(eq(robot_webhooks.store_id, storeId), eq(robot_webhooks.provider, input.provider)));
    }

    const after = await db
      .select()
      .from(robot_webhooks)
      .where(and(eq(robot_webhooks.store_id, storeId), eq(robot_webhooks.provider, input.provider)))
      .limit(1);
    return this.toPublicConfig(after[0] as any);
  }

  /** 删除某 provider 配置 */
  async removeConfig(provider: RobotProvider, storeId = 1) {
    await db
      .delete(robot_webhooks)
      .where(and(eq(robot_webhooks.store_id, storeId), eq(robot_webhooks.provider, provider)));
    return { ok: true };
  }

  // ============================================================
  // 发送（dispatcher 主入口）
  // ============================================================

  /**
   * 给指定事件触发所有启用 + 订阅了此事件的机器人
   * fire-and-forget：内部任何异常都吞掉
   */
  async sendForEvent(event: RobotEvent, msg: RobotMessage, storeId = 1): Promise<void> {
    try {
      const rows = await db
        .select()
        .from(robot_webhooks)
        .where(and(eq(robot_webhooks.store_id, storeId), eq(robot_webhooks.enabled, true)));

      if (rows.length === 0) return;

      // 并发发到三家（彼此独立）
      await Promise.allSettled(
        rows
          .filter((r) => this.parseEvents((r as any).events_json).includes(event))
          .map((r) => this.sendOne(r as any, msg)),
      );
    } catch (err) {
      // 顶层吞错
      this.logger.error(`[robot] sendForEvent error (吞掉): ${(err as Error).message}`);
    }
  }

  /** 测试发送（owner 在 UI 点"测试"按钮） */
  async testSend(provider: RobotProvider, storeId = 1): Promise<{ ok: boolean; reason?: string }> {
    const rows = await db
      .select()
      .from(robot_webhooks)
      .where(and(eq(robot_webhooks.store_id, storeId), eq(robot_webhooks.provider, provider)))
      .limit(1);
    if (rows.length === 0) return { ok: false, reason: '请先保存配置再测试' };
    return this.sendOne(rows[0] as any, {
      title: '🧪 通知配置测试',
      markdown: `### 🧪 通知测试\n\n如果你看到这条消息，说明 **${this.providerLabel(provider)}** 群机器人配置正常工作。\n\n— 扫码点餐通知服务`,
    });
  }

  // ============================================================
  // Provider drivers
  // ============================================================

  private async sendOne(row: any, msg: RobotMessage): Promise<{ ok: boolean; reason?: string }> {
    if (!this.checkRateLimit(row.id)) {
      this.logger.warn(`[robot] rate limit hit for webhook id=${row.id}, skipping`);
      return { ok: false, reason: 'rate_limited' };
    }
    let webhookUrl: string;
    let secret: string | null = null;
    try {
      webhookUrl = this.aes.decrypt(row.webhook_url_enc);
      if (row.secret_enc) secret = this.aes.decrypt(row.secret_enc);
    } catch (err) {
      const reason = '解密配置失败（AES_KEY 是否更换过？请重新填写 webhook）';
      await this.recordFailure(row.id, reason);
      return { ok: false, reason };
    }

    try {
      let r: { ok: boolean; reason?: string };
      switch (row.provider as RobotProvider) {
        case 'dingtalk':
          r = await this.sendDingtalk(webhookUrl, secret, msg);
          break;
        case 'wecom':
          r = await this.sendWecom(webhookUrl, msg);
          break;
        case 'feishu':
          r = await this.sendFeishu(webhookUrl, secret, msg);
          break;
        default:
          r = { ok: false, reason: `未知 provider: ${row.provider}` };
      }
      if (r.ok) {
        await this.recordSuccess(row.id);
      } else {
        await this.recordFailure(row.id, r.reason || '未知错误');
      }
      return r;
    } catch (err: any) {
      const reason = err?.message?.slice(0, 200) || '未知错误';
      await this.recordFailure(row.id, reason);
      return { ok: false, reason };
    }
  }

  // ---------- 钉钉 ----------
  private async sendDingtalk(
    webhookUrl: string,
    secret: string | null,
    msg: RobotMessage,
  ): Promise<{ ok: boolean; reason?: string }> {
    let url = webhookUrl;
    if (secret) {
      // 钉钉签名：timestamp&sign 拼到 URL
      const ts = Date.now();
      const stringToSign = `${ts}\n${secret}`;
      const sign = createHmac('sha256', secret).update(stringToSign).digest('base64');
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
    }
    const body = {
      msgtype: 'markdown',
      markdown: {
        title: msg.title,
        text: this.composeDingtalkText(msg),
      },
    };
    const r = await this.postJson(url, body);
    if (r.status === 200 && (r.json as any)?.errcode === 0) return { ok: true };
    const code = (r.json as any)?.errcode;
    const m = (r.json as any)?.errmsg;
    return { ok: false, reason: this.humanizeDingtalkError(code, m, r.status) };
  }

  private composeDingtalkText(msg: RobotMessage): string {
    return msg.url
      ? `${msg.markdown}\n\n[查看详情](${msg.url})`
      : msg.markdown;
  }

  private humanizeDingtalkError(code: any, m: any, status: number): string {
    if (code === 310000 || /sign not match/i.test(m || '')) {
      return '钉钉签名校验失败：请检查"加签密钥"是否正确（去群机器人设置 → 安全设置 → 加签 复制）';
    }
    if (code === 300001) return 'webhook URL 中的 access_token 无效（机器人是否被删除？）';
    if (code === 130101 || /not in the white list/i.test(m || '')) {
      return '机器人启用了 IP 白名单但服务器 IP 不在内，请关闭白名单或加入 IP';
    }
    if (status >= 400) return `钉钉返回 ${status}：${m || '请检查 webhook URL'}`;
    return m || `钉钉返回错误码 ${code}`;
  }

  // ---------- 企业微信 ----------
  private async sendWecom(
    webhookUrl: string,
    msg: RobotMessage,
  ): Promise<{ ok: boolean; reason?: string }> {
    const body = {
      msgtype: 'markdown',
      markdown: {
        content: this.composeWecomText(msg),
      },
    };
    const r = await this.postJson(webhookUrl, body);
    if (r.status === 200 && (r.json as any)?.errcode === 0) return { ok: true };
    const code = (r.json as any)?.errcode;
    const m = (r.json as any)?.errmsg;
    return { ok: false, reason: this.humanizeWecomError(code, m, r.status) };
  }

  private composeWecomText(msg: RobotMessage): string {
    // 企微 markdown 第一行作为标题加粗
    const head = `### ${msg.title}\n\n${msg.markdown}`;
    return msg.url ? `${head}\n\n[查看详情](${msg.url})` : head;
  }

  private humanizeWecomError(code: any, m: any, status: number): string {
    if (code === 93000) return 'webhook key 无效（机器人是否被删除？）';
    if (code === 45009 || /frequency limit/i.test(m || '')) {
      return '企微触发频率限流（20 条/分钟），稍后会自动重试';
    }
    if (status >= 400) return `企微返回 ${status}：${m || '请检查 webhook URL'}`;
    return m || `企微返回错误码 ${code}`;
  }

  // ---------- 飞书 ----------
  private async sendFeishu(
    webhookUrl: string,
    secret: string | null,
    msg: RobotMessage,
  ): Promise<{ ok: boolean; reason?: string }> {
    const ts = Math.floor(Date.now() / 1000);
    const body: any = {
      msg_type: 'interactive',
      card: this.composeFeishuCard(msg),
    };
    if (secret) {
      // 飞书签名：HMAC-SHA256(timestamp+"\n"+secret, "")，base64
      // 注意飞书的算法：用 (timestamp + "\n" + secret) 作为 key，对空字符串签名
      const stringToSign = `${ts}\n${secret}`;
      const sign = createHmac('sha256', stringToSign).update('').digest('base64');
      body.timestamp = String(ts);
      body.sign = sign;
    }
    const r = await this.postJson(webhookUrl, body);
    // 飞书成功响应：{ "code": 0, ... } 或 { "StatusCode": 0 }
    const j = (r.json as any) || {};
    if (r.status === 200 && (j.code === 0 || j.StatusCode === 0)) return { ok: true };
    const code = j.code ?? j.StatusCode;
    const m = j.msg || j.StatusMessage;
    return { ok: false, reason: this.humanizeFeishuError(code, m, r.status) };
  }

  private composeFeishuCard(msg: RobotMessage) {
    const elements: any[] = [
      { tag: 'div', text: { tag: 'lark_md', content: msg.markdown } },
    ];
    if (msg.url) {
      elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '查看订单详情' },
            type: 'primary',
            url: msg.url,
          },
        ],
      });
    }
    return {
      header: {
        title: { tag: 'plain_text', content: msg.title },
        template: 'blue',
      },
      elements,
    };
  }

  private humanizeFeishuError(code: any, m: any, status: number): string {
    if (code === 19021 || /signature is invalid/i.test(m || '')) {
      return '飞书签名校验失败：请检查"签名密钥"是否正确';
    }
    if (code === 19024) return 'webhook URL 无效（机器人是否被删除？）';
    if (status >= 400) return `飞书返回 ${status}：${m || '请检查 webhook URL'}`;
    return m || `飞书返回错误码 ${code}`;
  }

  // ============================================================
  // 共享工具
  // ============================================================

  private async postJson(url: string, body: any): Promise<{ status: number; json: unknown }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } finally {
      clearTimeout(t);
    }
  }

  private validateWebhookUrl(provider: RobotProvider, url: string) {
    if (!/^https:\/\//i.test(url)) {
      throw new Error('webhook URL 必须是 https://');
    }
    if (provider === 'dingtalk' && !/oapi\.dingtalk\.com/.test(url)) {
      throw new Error('钉钉 webhook 域名应为 oapi.dingtalk.com');
    }
    if (provider === 'wecom' && !/qyapi\.weixin\.qq\.com/.test(url)) {
      throw new Error('企业微信 webhook 域名应为 qyapi.weixin.qq.com');
    }
    if (provider === 'feishu' && !/(open\.feishu\.cn|open\.larksuite\.com)/.test(url)) {
      throw new Error('飞书 webhook 域名应为 open.feishu.cn 或 open.larksuite.com');
    }
    if (url.length > 1000) {
      throw new Error('webhook URL 过长');
    }
  }

  private parseEvents(raw: any): RobotEvent[] {
    let arr: any = raw;
    if (typeof raw === 'string') {
      try { arr = JSON.parse(raw); } catch { return []; }
    }
    if (!Array.isArray(arr)) return [];
    return arr.filter((e: any): e is RobotEvent =>
      e === 'NEW_ORDER' || e === 'ADD_ITEM' || e === 'REFUND',
    );
  }

  private dedupEvents(events: RobotEvent[]): RobotEvent[] {
    const order: RobotEvent[] = ['NEW_ORDER', 'ADD_ITEM', 'REFUND'];
    const set = new Set(events);
    return order.filter((e) => set.has(e));
  }

  private checkRateLimit(webhookId: number): boolean {
    const now = Date.now();
    const arr = this.rateLimitMap.get(webhookId) || [];
    // 清理 60s 之前的
    const recent = arr.filter((t) => now - t < 60_000);
    if (recent.length >= RATE_LIMIT_PER_PROVIDER_PER_MIN) {
      return false;
    }
    recent.push(now);
    this.rateLimitMap.set(webhookId, recent);
    return true;
  }

  private async recordSuccess(id: number) {
    try {
      await db
        .update(robot_webhooks)
        .set({
          last_sent_at: sql`CURRENT_TIMESTAMP`,
          last_error: null,
          failed_count: 0,
        })
        .where(eq(robot_webhooks.id, id));
    } catch { /* 写库失败不影响推送，吞掉 */ }
  }

  private async recordFailure(id: number, reason: string) {
    try {
      await db
        .update(robot_webhooks)
        .set({
          last_error: reason.slice(0, 500),
          failed_count: sql`${robot_webhooks.failed_count} + 1`,
        })
        .where(eq(robot_webhooks.id, id));
    } catch { /* ignore */ }
  }

  private toPublicConfig(row: any): RobotConfigPublic {
    return {
      provider: row.provider,
      enabled: !!row.enabled,
      has_webhook: !!row.webhook_url_enc,
      has_secret: !!row.secret_enc,
      events: this.parseEvents(row.events_json),
      last_sent_at: row.last_sent_at ? new Date(row.last_sent_at).toISOString() : null,
      last_error: row.last_error || null,
      failed_count: row.failed_count || 0,
    };
  }

  private providerLabel(p: RobotProvider): string {
    return { dingtalk: '钉钉', wecom: '企业微信', feishu: '飞书' }[p];
  }
}
