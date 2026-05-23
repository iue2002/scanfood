/**
 * Print 事件钩子
 *
 * 在 Module 启动时把 OrdersGateway.notifyAllAdmins 包成洋葱壳，
 * 在事件传给原方法后异步触发 PrintCore.onOrderEvent。
 *
 * 优点：
 *  - 完全不修改 OrdersService / OrdersGateway 文件
 *  - PrintCore 异常被 try/catch 完全包住（Property 19 故障隔离）
 *  - 可以随时通过保存的 origRef 还原
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OrdersGateway } from '@/modules/orders/orders.gateway';
import { PrintCore } from './print.core';

@Injectable()
export class PrintEventHook implements OnModuleInit {
  private readonly logger = new Logger(PrintEventHook.name);
  private installed = false;

  constructor(
    private readonly gateway: OrdersGateway,
    private readonly core: PrintCore,
  ) {}

  onModuleInit() {
    if (this.installed) return;
    this.installed = true;

    const origNotify = this.gateway.notifyAllAdmins.bind(this.gateway);
    const core = this.core;
    const logger = this.logger;

    (this.gateway as any).notifyAllAdmins = function (event: string, data: any) {
      // 1) 先走原通知（绝不能阻断）
      try {
        origNotify(event, data);
      } catch (err) {
        logger.warn(`[print-hook] orig notify failed: ${(err as Error).message}`);
      }
      // 2) 再异步触发自动打印（失败完全吞掉）
      try {
        if (event === 'orderStatusChanged' && data && data.id && data.status === 'submitted') {
          // 新订单提交（小程序提交、或商家代客点）
          void core.onOrderEvent(data.id, 'NEW_ORDER').catch((err: any) => {
            logger.warn(`[print-hook] NEW_ORDER auto print failed: ${err?.message ?? err}`);
          });
        } else if (event === 'orderUpdated' && data && data.id) {
          // 加餐：orderUpdated 在 syncAddMore / addOrderItem 处都会发；
          // 用 trigger='ADD_MORE'，由打印机 auto_print_add_more 决定是否真打。
          void core.onOrderEvent(data.id, 'ADD_MORE').catch((err: any) => {
            logger.warn(`[print-hook] ADD_MORE auto print failed: ${err?.message ?? err}`);
          });
        }
      } catch (err) {
        // 钩子内任何同步异常都被吞
        logger.warn(`[print-hook] hook error: ${(err as Error).message}`);
      }
    };

    this.logger.log('[print-hook] installed on OrdersGateway.notifyAllAdmins');
  }
}
