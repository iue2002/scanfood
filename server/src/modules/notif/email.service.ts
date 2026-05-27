/**
 * 邮件通知服务
 *
 * 双模式 SMTP：
 *   - platform：用 .env 里的 SMTP_PLATFORM_*（你的统一发件账号）
 *   - custom：用 store_settings 里店主自己配的 SMTP（密码 AES 加密）
 *
 * 设计哲学：
 *   - fire-and-forget：永远不阻塞订单主流程
 *   - 限流：同一收件邮箱 30 秒内只发 1 封；全局每分钟 60 封
 *   - 限流 Map 有界（LRU 1024，淘汰最老 entry，避免内存泄漏）
 *   - SMTP 配置错误时，写日志 + return false，不抛错
 *   - Transporter 缓存：避免每封邮件重新建立 SMTP 连接（性能/连接数）
 *   - 超时：全链路 hard timeout 25s，避免长时间占用
 *   - 测试连接：提供单独的 testConnection() 给 NotifSettings UI"测试发送"按钮
 */
import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { db } from '@/storage/database/mysql-client';
import { store_settings } from '@/storage/database/shared/schema';
import { AesEncryptorService } from '../merchant-ops/print/aes-encryptor';
import { NotifTemplateCore } from './notif-template/notif-template.core';

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
}

export interface OrderEmailParams {
  to: string;
  storeName: string;
  recipientName?: string;
  orderNumber: string;
  tableLabel: string; // "5号桌" 或 "外带"
  totalAmount: string; // "76.00"
  items: Array<{ name: string; quantity: number; subtotal: string }>;
  createdAt: string; // 已格式化字符串
  /** 跳转 URL（admin-web 订单详情）；可选 */
  detailUrl?: string;
  /** 事件类型（用于邮件主题） */
  event: 'NEW_ORDER' | 'ADD_ITEM' | 'REFUND';
}

const SEND_TIMEOUT_MS = 25_000;
const MAX_RATE_LIMIT_ENTRIES = 1024;

@Injectable()
export class EmailNotificationService {
  private readonly logger = new Logger(EmailNotificationService.name);

  // 限流：每个邮箱最近一次发送时间戳（有界 LRU）
  private readonly lastSentMap = new Map<string, number>();
  private readonly RATE_LIMIT_PER_EMAIL_MS = 30_000; // 30 秒
  // 全局每分钟限流
  private globalSentCount = 0;
  private globalWindowStart = Date.now();
  private readonly GLOBAL_LIMIT_PER_MIN = 60;

  // Transporter 缓存：按 SMTP 配置指纹复用
  // 一旦配置变化，旧 transporter 自动 close + 替换
  private cachedTransporter: nodemailer.Transporter | null = null;
  private cachedFingerprint: string | null = null;

  constructor(
    private readonly aes: AesEncryptorService,
    private readonly templateCore: NotifTemplateCore,
  ) {}

  /**
   * 检查 SMTP 是否可用（任一模式有完整配置即可）
   */
  async isAvailable(): Promise<boolean> {
    const platformOk = this.getPlatformConfig() !== null;
    const customOk = (await this.getCustomConfig().catch(() => null)) !== null;
    return platformOk || customOk;
  }

  /**
   * 读取 .env 中的平台 SMTP（你买的阿里云邮件推送 / SendGrid 等）
   */
  private getPlatformConfig(): SmtpConfig | null {
    const host = process.env.SMTP_PLATFORM_HOST;
    const portStr = process.env.SMTP_PLATFORM_PORT;
    const user = process.env.SMTP_PLATFORM_USER;
    const pass = process.env.SMTP_PLATFORM_PASS;
    const from = process.env.SMTP_PLATFORM_FROM;
    if (!host || !portStr || !user || !pass || !from) return null;
    return {
      host,
      port: parseInt(portStr, 10) || 465,
      user,
      pass,
      from,
      secure: (process.env.SMTP_PLATFORM_SECURE || 'true').toLowerCase() === 'true',
    };
  }

  /**
   * 读取店铺自定义 SMTP（DB 里 store_settings.smtp_*）
   */
  private async getCustomConfig(): Promise<SmtpConfig | null> {
    const rows = await db.select().from(store_settings).limit(1);
    if (rows.length === 0) return null;
    const row = rows[0] as any;
    if (!row.smtp_host || !row.smtp_port || !row.smtp_user || !row.smtp_pass_enc || !row.smtp_from) {
      return null;
    }
    let pass: string;
    try {
      pass = this.aes.decrypt(row.smtp_pass_enc);
    } catch (err) {
      this.logger.error(`[email] decrypt SMTP password failed: ${(err as Error).message}`);
      return null;
    }
    return {
      host: row.smtp_host,
      port: row.smtp_port,
      user: row.smtp_user,
      pass,
      from: row.smtp_from,
      secure: !!row.smtp_secure,
    };
  }

  /**
   * 选当前生效的 SMTP（按 store_settings.smtp_mode）
   */
  private async resolveActiveConfig(): Promise<SmtpConfig | null> {
    const rows = await db.select({ smtp_mode: store_settings.smtp_mode }).from(store_settings).limit(1);
    const mode = rows[0]?.smtp_mode || 'platform';
    if (mode === 'custom') {
      return (await this.getCustomConfig()) ?? this.getPlatformConfig();
    }
    return this.getPlatformConfig() ?? (await this.getCustomConfig());
  }

  /** 计算 SMTP 配置的指纹（用于 transporter 缓存失效） */
  private fingerprint(c: SmtpConfig): string {
    // 把密码哈希进去（不直接拼明文），避免 logs/heap dump 风险
    let h = 0;
    for (let i = 0; i < c.pass.length; i++) {
      h = (h * 31 + c.pass.charCodeAt(i)) | 0;
    }
    return `${c.host}|${c.port}|${c.secure ? 1 : 0}|${c.user}|${c.from}|${h}`;
  }

  /**
   * 获取（或创建）一个复用的 transporter；配置变化自动重建
   */
  private getTransporter(c: SmtpConfig): nodemailer.Transporter {
    const fp = this.fingerprint(c);
    if (this.cachedTransporter && this.cachedFingerprint === fp) {
      return this.cachedTransporter;
    }
    // 配置变了：关闭旧的（best-effort）
    if (this.cachedTransporter) {
      try { this.cachedTransporter.close(); } catch { /* ignore */ }
    }
    this.cachedTransporter = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: { user: c.user, pass: c.pass },
      // 单连接池：避免高峰期开太多 socket
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    this.cachedFingerprint = fp;
    return this.cachedTransporter;
  }

  /** Promise + 硬超时包装 */
  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
      p.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); },
      );
    });
  }

  /** 限流 Map 写入时做 LRU 上限保护 */
  private trackRateLimit(toEmail: string, now: number) {
    if (this.lastSentMap.size >= MAX_RATE_LIMIT_ENTRIES) {
      // 简单 LRU：删除最老（首个 key，Map 保持插入顺序）
      const oldest = this.lastSentMap.keys().next().value;
      if (oldest) this.lastSentMap.delete(oldest);
    }
    this.lastSentMap.set(toEmail, now);
  }

  /**
   * 限流检查：通过返回 true，被限流返回 false
   */
  private checkRateLimit(toEmail: string): boolean {
    const now = Date.now();
    // 全局每分钟窗口
    if (now - this.globalWindowStart > 60_000) {
      this.globalWindowStart = now;
      this.globalSentCount = 0;
    }
    if (this.globalSentCount >= this.GLOBAL_LIMIT_PER_MIN) {
      this.logger.warn(`[email] global rate limit hit (60/min), skipping ${toEmail}`);
      return false;
    }
    // 单收件人 30 秒
    const last = this.lastSentMap.get(toEmail) || 0;
    if (now - last < this.RATE_LIMIT_PER_EMAIL_MS) {
      this.logger.log(`[email] per-email rate limit, skipping ${toEmail}`);
      return false;
    }
    return true;
  }

  /**
   * 发送一封订单通知邮件（fire-and-forget）
   */
  async sendOrderEmail(params: OrderEmailParams): Promise<{ ok: boolean; reason?: string }> {
    if (!params.to) return { ok: false, reason: '收件人为空' };
    if (!this.checkRateLimit(params.to)) {
      return { ok: false, reason: 'rate_limited' };
    }

    const config = await this.resolveActiveConfig();
    if (!config) {
      return { ok: false, reason: 'SMTP 未配置（platform / custom 都缺）' };
    }

    try {
      const transporter = this.getTransporter(config);

      const rendered = await this.renderEmailTemplate(params);

      await this.withTimeout(
        transporter.sendMail({
          from: config.from,
          to: params.to,
          subject: rendered.subject,
          html: rendered.html || rendered.text.replace(/\n/g, '<br>'),
          text: rendered.text,
        }),
        SEND_TIMEOUT_MS,
        '[email] sendMail',
      );

      this.trackRateLimit(params.to, Date.now());
      this.globalSentCount++;
      this.logger.log(`[email] sent to ${params.to}: ${rendered.subject}`);
      return { ok: true };
    } catch (err: any) {
      this.logger.warn(`[email] send failed to ${params.to}: ${err?.message?.slice(0, 200)}`);
      return { ok: false, reason: this.humanizeError(err) };
    }
  }

  /**
   * 测试 SMTP 连接（NotifSettings UI 的"发送测试邮件"按钮调用）
   *
   * 注意：测试不走缓存 transporter（用户刚改完配置，可能旧 transporter 还指向旧值）；
   * 也不写 lastSentMap（测试不影响后续真实通知的限流窗口）
   */
  async testConnection(toEmail: string, mode: 'platform' | 'custom' = 'platform'): Promise<{ ok: boolean; reason?: string }> {
    const config =
      mode === 'custom'
        ? await this.getCustomConfig()
        : this.getPlatformConfig() ?? (await this.getCustomConfig());
    if (!config) {
      return {
        ok: false,
        reason: mode === 'custom' ? '请先填写自定义 SMTP 配置' : '平台 SMTP 未配置（联系管理员）',
      };
    }
    let transporter: nodemailer.Transporter | null = null;
    try {
      transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.pass },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });

      await this.withTimeout(
        transporter.sendMail({
          from: config.from,
          to: toEmail,
          subject: '【扫码点餐】通知配置测试',
          text: '如果你看到这封邮件，说明 SMTP 配置工作正常。',
          html: `<p>如果你看到这封邮件，说明 SMTP 配置工作正常。</p>
                 <p style="color:#94A3B8;font-size:12px;">— 扫码点餐通知服务</p>`,
        }),
        SEND_TIMEOUT_MS,
        '[email] testConnection',
      );
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: this.humanizeError(err) };
    } finally {
      if (transporter) {
        try { transporter.close(); } catch { /* ignore */ }
      }
    }
  }

  /**
   * 把 nodemailer 错误码翻译成人话
   */
  private humanizeError(err: any): string {
    const code = err?.code || '';
    const msg = err?.message || '未知错误';
    if (code === 'EAUTH') return '账号或密码错误（QQ/163 邮箱请使用授权码而非登录密码）';
    if (code === 'ECONNECTION' || code === 'ESOCKET') return '无法连接 SMTP 服务器（检查 host 和 port，或服务器防火墙）';
    if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) return 'SMTP 连接超时（服务器无响应）';
    if (code === 'EDNS') return '无法解析 SMTP 域名（host 拼错？）';
    if (code === 'EMESSAGE') return '收件人邮箱被拒绝';
    return msg.slice(0, 200);
  }

  // ========== 邮件内容构造 ==========

  private async renderEmailTemplate(
    p: OrderEmailParams,
  ): Promise<{ subject: string; text: string; html: string | null }> {
    const eventLabel = { NEW_ORDER: '新订单', ADD_ITEM: '加菜通知', REFUND: '退款申请' }[p.event];
    const itemsSummary = p.items
      .map((i) => `- ${i.name} × ${i.quantity}  ¥${i.subtotal}`)
      .join('\n');

    const rendered = await this.templateCore.render(p.event, 'email', {
      storeName: p.storeName,
      tableLabel: p.tableLabel,
      orderNumber: p.orderNumber,
      totalAmount: p.totalAmount,
      createdAt: p.createdAt,
      itemsSummary,
      detailUrl: p.detailUrl || '',
      eventLabel,
      recipientName: p.recipientName || '',
    });

    return { subject: rendered.title, text: rendered.body, html: rendered.html };
  }
}
