/**
 * 中易云 / 365 云打印 Driver
 *
 * 协议：POST application/x-www-form-urlencoded
 * 端点：https://www.365cup.com/openapi/printOrder
 * 文档：https://www.365cup.com/openapi/doc.html
 *
 * 鉴权：sign = MD5(memberCode + apiKey + timestamp).toUpperCase()
 *
 * 配置（.env）：
 *   ZYY_MEMBER_CODE=xxx       # 商户编号
 *   ZYY_API_KEY=xxx           # API 密钥
 *   ZYY_API_BASE=https://www.365cup.com/openapi
 *
 * device_sn = 终端设备号（终端 SN）
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

@Injectable()
export class ZyyPrinterDriver implements PrinterDriverPort {
  private readonly logger = new Logger(ZyyPrinterDriver.name);

  private get memberCode(): string { return process.env.ZYY_MEMBER_CODE || ''; }
  private get apiKey(): string { return process.env.ZYY_API_KEY || ''; }
  private get apiBase(): string { return (process.env.ZYY_API_BASE || 'https://www.365cup.com/openapi').replace(/\/$/, ''); }

  private isConfigured(): boolean {
    return this.memberCode.length > 0 && this.apiKey.length > 0;
  }

  /** 签名：MD5(memberCode + apiKey + timestamp) 大写 */
  private sign(timestamp: string): string {
    return createHash('md5').update(`${this.memberCode}${this.apiKey}${timestamp}`).digest('hex').toUpperCase();
  }

  /**
   * 中易云内容格式：纯文本，每行末加 \n；居中标题用特殊指令 <CB>...</CB>
   * 这里简化为 ESC/POS 文本（多数中易云型号能直接打）。
   */
  private buildContent(payload: PrintPayload): string {
    const tpl = { id: 0, name: '', fields_json: payload.fields, width: payload.width, created_at: new Date(), updated_at: new Date() };
    return PrintCore.renderEscPos(tpl, payload);
  }

  async send(printer: PrinterRow, payload: PrintPayload, timeoutMs: number): Promise<DriverResponse> {
    if (!this.isConfigured()) {
      return { accepted: false, errorCode: 'ZYY_NOT_CONFIGURED', errorMessage: 'ZYY_MEMBER_CODE/API_KEY 未配置' };
    }
    if (!printer.device_sn) {
      return { accepted: false, errorCode: 'PRINTER_INVALID', errorMessage: 'device_sn 缺失' };
    }
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params: Record<string, string> = {
      memberCode: this.memberCode,
      sn: printer.device_sn,
      content: this.buildContent(payload),
      timestamp,
      sign: this.sign(timestamp),
      copies: '1',
    };
    const r = await postForm<any>(`${this.apiBase}/printOrder`, params, timeoutMs);
    if (!r.ok) {
      return { accepted: false, errorCode: r.errorCode || 'PRINT_FAILED', errorMessage: r.errorMessage };
    }
    const body = r.body;
    // 中易云返回：{ code: 0, msg: 'success', data: { orderId } } 或文本
    if (body?.code === 0 || body?.code === '0') {
      return { accepted: true, providerJobId: body?.data?.orderId ?? null };
    }
    return {
      accepted: false,
      errorCode: `UPSTREAM_${body?.code ?? 'UNKNOWN'}`,
      errorMessage: body?.msg || 'zyy print failed',
    };
  }

  async queryOnline(printer: PrinterRow): Promise<{ online: boolean; lastSeen?: Date }> {
    if (!this.isConfigured() || !printer.device_sn) return { online: false };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params: Record<string, string> = {
      memberCode: this.memberCode,
      sn: printer.device_sn,
      timestamp,
      sign: this.sign(timestamp),
    };
    const r = await postForm<any>(`${this.apiBase}/queryPrinterStatus`, params, 5000);
    if (!r.ok) return { online: false };
    const body = r.body;
    if (body?.code === 0 || body?.code === '0') {
      // status: online / offline / busy
      return { online: body?.data?.status === 'online', lastSeen: new Date() };
    }
    return { online: false };
  }
}
