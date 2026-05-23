/**
 * 浏览器打印 Driver（占位）
 *
 * BROWSER provider 的实际打印发生在 admin-web 端 window.print()。
 * 后端只是返回 accepted=true，把 ESC/POS / HTML 推到 mop:browser-print 事件，
 * admin-web NotificationCenter 接收后弹出预览窗口完成打印。
 *
 * 因为是被动模型，queryOnline 永远返回在线（只要有 admin-web 会话连着就视为可用）。
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  DriverResponse,
  PrinterDriverPort,
  PrinterRow,
  PrintPayload,
} from '../print.types';
import { PrintCore } from '../print.core';
import type { MopEventEmitter } from '../print.core';

@Injectable()
export class BrowserPrinterDriver implements PrinterDriverPort {
  private readonly logger = new Logger(BrowserPrinterDriver.name);

  // 由 module 注入
  private emitter: MopEventEmitter | null = null;

  setEmitter(emitter: MopEventEmitter) {
    this.emitter = emitter;
  }

  async send(printer: PrinterRow, payload: PrintPayload, _timeoutMs: number): Promise<DriverResponse> {
    if (!this.emitter) {
      return { accepted: false, errorCode: 'EVENT_BUS_UNAVAILABLE' };
    }
    try {
      // 渲染 HTML 一次性发给前端弹窗
      const tpl = {
        id: printer.template_id ?? 0,
        name: printer.name,
        fields_json: payload.fields,
        width: payload.width,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const html = PrintCore.renderHtml(tpl, payload);
      this.emitter.emit('mop:browser-print', {
        printerId: printer.id,
        printerName: printer.name,
        html,
        width: payload.width,
      });
      return { accepted: true, providerJobId: `browser-${Date.now()}` };
    } catch (err) {
      return { accepted: false, errorCode: 'PRINT_FAILED', errorMessage: (err as Error).message };
    }
  }

  async queryOnline(_printer: PrinterRow): Promise<{ online: boolean; lastSeen?: Date }> {
    return { online: true, lastSeen: new Date() };
  }
}
