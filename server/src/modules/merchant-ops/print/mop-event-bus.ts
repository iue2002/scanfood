/**
 * mop:* WebSocket 事件总线（Property 22 / R19.2）
 *
 * 类型层：emit 的 event 必须是 `mop:${string}` 字面量；TypeScript 在编译期阻断非法值。
 * 运行时：再做一次 prefix 断言；尝试发非 mop:* 立即 throw，且不会触达既有 OrdersGateway 的 notify 通道。
 *
 * 适配器层把广播桥接到 OrdersGateway.notifyAllAdmins。
 */
import { Injectable, Logger } from '@nestjs/common';
import { OrdersGateway } from '@/modules/orders/orders.gateway';
import type { MopEventEmitter } from './print.core';

@Injectable()
export class MopEventBus implements MopEventEmitter {
  private readonly logger = new Logger(MopEventBus.name);

  constructor(private readonly gateway: OrdersGateway) {}

  emit(event: `mop:${string}`, payload: any): void {
    if (typeof event !== 'string' || !event.startsWith('mop:')) {
      throw new Error(`MopEventBus.emit rejected non-mop event: ${event}`);
    }
    try {
      this.gateway.notifyAllAdmins(event, payload);
    } catch (err) {
      // 桥接失败仅记日志，不冒泡（R19.5）
      this.logger.warn(`[mop-bus] emit ${event} failed: ${(err as Error).message}`);
    }
  }
}
