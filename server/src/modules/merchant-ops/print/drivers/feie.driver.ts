/**
 * 飞鹅云打印机 Driver
 *
 * 协议：POST application/x-www-form-urlencoded
 * 签名：sign = SHA1(USER + UKEY + time)，time 为秒级 unix；偏差需 ≤ 600s
 * 文档：http://help.feieyun.com/document.php
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import type {
  DriverResponse,
  PrinterDriverPort,
  PrinterRow,
  PrintPayload,
} from '../print.types';
import { PrintCore } from '../print.core';

@Injectable()
export class FeiePrinterDriver implements PrinterDriverPort {
  private readonly logger = new Logger(FeiePrinterDriver.name);

  private get user(): string { return process.env.FEIE_USER || ''; }
  private get ukey(): string { return process.env.FEIE_UKEY || ''; }
  private get apiBase(): string { return process.env.FEIE_API_BASE || 'https://api.feieyun.cn/Api/Open/'; }

  private isConfigured(): boolean {
    return this.user.length > 0 && this.ukey.length > 0;
  }

  private sign(time: number): string {
    return createHash('sha1').update(`${this.user}${this.ukey}${time}`).digest('hex');
  }

  /**
   * 飞鹅打印格式：HTML-like 标签（<BR>、<C>、<L>、<B>、<W> 等）
   * 把 PrintCore 渲染的 ESC/POS 文本简单转换：每行后加 <BR>
   */
  private buildContent(printer: PrinterRow, payload: PrintPayload): string {
    // 简单包装：FEIE 接受文本 + <BR> 换行 + <CB> 居中加粗
    // 如果 payload.fields 包含 STORE_NAME，把它放最前面用 <CB>
    const tpl = { id: 0, name: '', fields_json: payload.fields, width: payload.width, created_at: new Date(), updated_at: new Date() };
    const escpos = PrintCore.renderEscPos(tpl, payload);
    return escpos
      .split('\n')
      .map((line) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
      .join('<BR>');
  }

  async send(printer: PrinterRow, payload: PrintPayload, timeoutMs: number): Promise<DriverResponse> {
    if (!this.isConfigured()) {
      return { accepted: false, errorCode: 'FEIE_NOT_CONFIGURED', errorMessage: 'FEIE_USER/FEIE_UKEY 未配置' };
    }
    if (!printer.device_sn) {
      return { accepted: false, errorCode: 'PRINTER_INVALID', errorMessage: 'device_sn 缺失' };
    }
    const time = Math.floor(Date.now() / 1000);
    const content = this.buildContent(printer, payload);
    const params = new URLSearchParams({
      user: this.user,
      stime: String(time),
      sig: this.sign(time),
      apiname: 'Open_printMsg',
      sn: printer.device_sn,
      content,
      times: '1',
    });
    try {
      const resp = await this.postForm(this.apiBase, params.toString(), timeoutMs);
      // 飞鹅返回：{ msg, ret, data, serverExecutedTime }
      // ret = 0 / data 为 jobId 时成功
      const json: any = JSON.parse(resp);
      if (json && (json.ret === 0 || json.ret === '0')) {
        return { accepted: true, providerJobId: json.data ?? null };
      }
      return {
        accepted: false,
        errorCode: `UPSTREAM_${json?.ret ?? 'UNKNOWN'}`,
        errorMessage: json?.msg ?? 'feie 返回错误',
      };
    } catch (err) {
      const msg = (err as Error).message || 'feie request failed';
      return { accepted: false, errorCode: msg.includes('timeout') ? 'UPSTREAM_TIMEOUT' : 'PRINT_FAILED', errorMessage: msg };
    }
  }

  async queryOnline(printer: PrinterRow): Promise<{ online: boolean; lastSeen?: Date }> {
    if (!this.isConfigured() || !printer.device_sn) return { online: false };
    const time = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams({
      user: this.user,
      stime: String(time),
      sig: this.sign(time),
      apiname: 'Open_queryPrinterStatus',
      sn: printer.device_sn,
    });
    try {
      const resp = await this.postForm(this.apiBase, params.toString(), 5_000);
      const json: any = JSON.parse(resp);
      // ret=0 时 data 为 "在线，工作状态正常" / "离线" 等中文
      if (json?.ret === 0 || json?.ret === '0') {
        const text = String(json.data ?? '');
        return { online: text.includes('在线'), lastSeen: new Date() };
      }
      return { online: false };
    } catch {
      return { online: false };
    }
  }

  private postForm(url: string, body: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const lib: any = u.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          method: 'POST',
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: timeoutMs,
        },
        (res: any) => {
          let chunks = '';
          res.on('data', (c: any) => { chunks += c.toString('utf8'); });
          res.on('end', () => resolve(chunks));
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('feie request timeout'));
      });
      req.write(body);
      req.end();
    });
  }
}
