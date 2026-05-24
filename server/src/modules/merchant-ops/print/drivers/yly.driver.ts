/**
 * 易联云打印机 Driver
 *
 * 协议：POST application/x-www-form-urlencoded（OpenAPI v2）
 * 端点：https://open-api.10ss.net/v2/printer/print
 * 文档：https://www.10ss.net/document.html（v2 OpenAPI）
 *
 * 鉴权：易联云有两套——
 *   1. 标准 OAuth2 + RSA（生产推荐，需要应用商家授权）
 *   2. 快速接入 client_credentials（直接 client_id + client_secret 拿 access_token）
 * 这里实现 #2，更适合自有商户场景。
 *
 * 签名：sign = MD5(client_id + access_token + timestamp + client_secret)
 *
 * 配置（.env）：
 *   YLY_CLIENT_ID=xxx
 *   YLY_CLIENT_SECRET=xxx
 *   YLY_API_BASE=https://open-api.10ss.net
 *
 * device_sn = 终端号（机器号）
 * device_key = 终端密钥（PrinterRow.device_key 解密后）
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  DriverResponse,
  PrinterDriverPort,
  PrinterRow,
  PrintPayload,
} from '../print.types';
import { PrintCore } from '../print.core';
import { postForm } from './http-client';

interface YlyTokenCache {
  token: string;
  expiresAt: number;  // unix ms
}

@Injectable()
export class YlyPrinterDriver implements PrinterDriverPort {
  private readonly logger = new Logger(YlyPrinterDriver.name);
  private tokenCache: YlyTokenCache | null = null;

  private get clientId(): string { return process.env.YLY_CLIENT_ID || ''; }
  private get clientSecret(): string { return process.env.YLY_CLIENT_SECRET || ''; }
  private get apiBase(): string { return (process.env.YLY_API_BASE || 'https://open-api.10ss.net').replace(/\/$/, ''); }

  private isConfigured(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  /**
   * 易联云内容格式：纯文本，用 <BR> 换行 + <CB></CB> 大字居中
   * 与飞鹅类似但标签略有差异。这里走简单路径：把 ESC/POS 文本逐行 + <BR>。
   */
  private buildContent(payload: PrintPayload): string {
    const tpl = { id: 0, name: '', fields_json: payload.fields, width: payload.width, created_at: new Date(), updated_at: new Date() };
    const escpos = PrintCore.renderEscPos(tpl, payload);
    return escpos
      .split('\n')
      .map((line) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
      .join('<BR>');
  }

  /** MD5 签名：易联云 v2 标准 */
  private sign(timestamp: string, accessToken: string): string {
    return createHash('md5').update(`${this.clientId}${accessToken}${timestamp}${this.clientSecret}`).digest('hex');
  }

  /**
   * 拿 access_token（缓存 24h）
   */
  private async getAccessToken(timeoutMs: number): Promise<{ token: string } | { error: string }> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return { token: this.tokenCache.token };
    }
    const params = {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'client_credentials',
      scope: 'all',
    };
    const r = await postForm<any>(`${this.apiBase}/oauth/oauth`, params, timeoutMs);
    if (!r.ok) return { error: r.errorCode || 'NETWORK_ERROR' };
    const body = r.body;
    if (body?.error === 0 || body?.error === '0') {
      const token = body?.body?.access_token;
      const expires = body?.body?.expires_in ?? 86400; // 秒
      if (token) {
        this.tokenCache = { token, expiresAt: now + (expires - 300) * 1000 };  // 提前 5min 过期
        return { token };
      }
    }
    return { error: `UPSTREAM_${body?.error ?? 'AUTH_FAILED'}` };
  }

  async send(printer: PrinterRow, payload: PrintPayload, timeoutMs: number): Promise<DriverResponse> {
    if (!this.isConfigured()) {
      return { accepted: false, errorCode: 'YLY_NOT_CONFIGURED', errorMessage: 'YLY_CLIENT_ID/CLIENT_SECRET 未配置' };
    }
    if (!printer.device_sn) {
      return { accepted: false, errorCode: 'PRINTER_INVALID', errorMessage: 'device_sn 缺失' };
    }
    const tokenR = await this.getAccessToken(timeoutMs);
    if ('error' in tokenR) {
      return { accepted: false, errorCode: tokenR.error };
    }
    const timestamp = String(Math.floor(Date.now() / 1000));
    const content = this.buildContent(payload);
    const params: Record<string, string> = {
      client_id: this.clientId,
      access_token: tokenR.token,
      timestamp,
      sign: this.sign(timestamp, tokenR.token),
      id: `${Date.now()}-${printer.id}`,  // 业务订单号（去重）
      machine_code: printer.device_sn,
      content,
      origin_id: String(printer.id),
    };
    const r = await postForm<any>(`${this.apiBase}/v2/printer/print`, params, timeoutMs);
    if (!r.ok) {
      return { accepted: false, errorCode: r.errorCode || 'PRINT_FAILED', errorMessage: r.errorMessage };
    }
    const body = r.body;
    // 易联云返回：{ error: 0, body: { id }, error_description: 'success' }
    if (body?.error === 0 || body?.error === '0') {
      return { accepted: true, providerJobId: body?.body?.id ?? null };
    }
    return {
      accepted: false,
      errorCode: `UPSTREAM_${body?.error ?? 'UNKNOWN'}`,
      errorMessage: body?.error_description || 'yly print failed',
    };
  }

  async queryOnline(printer: PrinterRow): Promise<{ online: boolean; lastSeen?: Date }> {
    if (!this.isConfigured() || !printer.device_sn) return { online: false };
    const tokenR = await this.getAccessToken(5000);
    if ('error' in tokenR) return { online: false };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params: Record<string, string> = {
      client_id: this.clientId,
      access_token: tokenR.token,
      timestamp,
      sign: this.sign(timestamp, tokenR.token),
      machine_code: printer.device_sn,
    };
    const r = await postForm<any>(`${this.apiBase}/printer/getprintstatus`, params, 5000);
    if (!r.ok) return { online: false };
    const body = r.body;
    if (body?.error === 0) {
      // body.body.state: 0=离线 1=在线 2=异常
      const state = body?.body?.state;
      return { online: state === 1 || state === '1', lastSeen: new Date() };
    }
    return { online: false };
  }
}
