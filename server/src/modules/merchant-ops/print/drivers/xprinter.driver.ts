/**
 * 芯烨云打印机 Driver
 *
 * 协议：POST application/json
 * 端点：https://open.xpyun.net/api/openapi/xprinter/print
 * 文档：https://open.xpyun.net/help/index.html
 *
 * 鉴权：sign = SHA1(user + userKey + timestamp)
 *
 * 配置（.env）：
 *   XPRINTER_USER=xxx          # 平台账号
 *   XPRINTER_USER_KEY=xxx      # 用户 KEY
 *   XPRINTER_API_BASE=https://open.xpyun.net/api/openapi/xprinter
 *
 * device_sn = 终端号
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
import { postJson } from './http-client';

@Injectable()
export class XPrinterDriver implements PrinterDriverPort {
  private readonly logger = new Logger(XPrinterDriver.name);

  private get user(): string { return process.env.XPRINTER_USER || ''; }
  private get userKey(): string { return process.env.XPRINTER_USER_KEY || ''; }
  private get apiBase(): string { return (process.env.XPRINTER_API_BASE || 'https://open.xpyun.net/api/openapi/xprinter').replace(/\/$/, ''); }

  private isConfigured(): boolean {
    return this.user.length > 0 && this.userKey.length > 0;
  }

  /** 签名：SHA1(user + userKey + timestamp) */
  private sign(timestamp: number): string {
    return createHash('sha1').update(`${this.user}${this.userKey}${timestamp}`).digest('hex');
  }

  /**
   * 芯烨云内容格式：富文本（支持 <C>居中</C> <B>加粗</B> <BR>换行 等标签），
   * 简化路径：ESC/POS 文本逐行 + <BR>。
   */
  private buildContent(payload: PrintPayload): string {
    const tpl = { id: 0, name: '', fields_json: payload.fields, width: payload.width, created_at: new Date(), updated_at: new Date() };
    const escpos = PrintCore.renderEscPos(tpl, payload);
    return escpos
      .split('\n')
      .map((line) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
      .join('<BR>');
  }

  async send(printer: PrinterRow, payload: PrintPayload, timeoutMs: number): Promise<DriverResponse> {
    if (!this.isConfigured()) {
      return { accepted: false, errorCode: 'XPRINTER_NOT_CONFIGURED', errorMessage: 'XPRINTER_USER/USER_KEY 未配置' };
    }
    if (!printer.device_sn) {
      return { accepted: false, errorCode: 'PRINTER_INVALID', errorMessage: 'device_sn 缺失' };
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const body = {
      user: this.user,
      timestamp,
      sign: this.sign(timestamp),
      debug: '0',
      sn: printer.device_sn,
      content: this.buildContent(payload),
      copies: 1,
      mode: 0,  // 0=订单 1=标签
    };
    const r = await postJson<any>(`${this.apiBase}/print`, body, timeoutMs);
    if (!r.ok) {
      return { accepted: false, errorCode: r.errorCode || 'PRINT_FAILED', errorMessage: r.errorMessage };
    }
    const resp = r.body;
    // 芯烨云返回：{ msg: 'ok', code: 0, data: '<orderId>', serverExecutedTime: 12 }
    if (resp?.code === 0 || resp?.code === '0') {
      return { accepted: true, providerJobId: resp?.data ?? null };
    }
    return {
      accepted: false,
      errorCode: `UPSTREAM_${resp?.code ?? 'UNKNOWN'}`,
      errorMessage: resp?.msg || 'xprinter print failed',
    };
  }

  async queryOnline(printer: PrinterRow): Promise<{ online: boolean; lastSeen?: Date }> {
    if (!this.isConfigured() || !printer.device_sn) return { online: false };
    const timestamp = Math.floor(Date.now() / 1000);
    const body = {
      user: this.user,
      timestamp,
      sign: this.sign(timestamp),
      sn: printer.device_sn,
    };
    const r = await postJson<any>(`${this.apiBase}/queryPrinterStatus`, body, 5000);
    if (!r.ok) return { online: false };
    const resp = r.body;
    if (resp?.code === 0) {
      // data: 0=离线 1=在线（普通） 2=在线（缺纸）
      const online = resp?.data === 1 || resp?.data === '1';
      return { online, lastSeen: new Date() };
    }
    return { online: false };
  }
}
