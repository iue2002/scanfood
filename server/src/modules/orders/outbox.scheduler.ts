/**
 * OutboxScheduler：定期拉取 event_outbox 中待处理事件并派发
 *
 * P1-1：事件投递箱的消费端
 * 作为内联副作用的兜底保障（进程崩溃后 pending 事件仍会被重试）
 *
 * 重试策略：exponential backoff（5s → 2min），最多 5 次
 * 所有派发 fire-and-forget，异常被吞掉并标记 nack
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EVENT_OUTBOX_TOKEN } from '@/modules/common/adapters/mysql-event-outbox.adapter';
import type { EventOutboxPort } from '@/modules/common/ports/event-outbox.port';
import { OrdersGateway } from './orders.gateway';
import { NotificationDispatcherService } from '../notif/notification-dispatcher.service';
import { OrdersService } from './orders.service';

@Injectable()
export class OutboxScheduler {
  private readonly logger = new Logger(OutboxScheduler.name);

  constructor(
    @Inject(EVENT_OUTBOX_TOKEN)
    private readonly outbox: EventOutboxPort,
    private readonly ordersGateway: OrdersGateway,
    private readonly notifDispatcher: NotificationDispatcherService,
    private readonly ordersService: OrdersService,
  ) {}

  /** 每 5 秒拉取一批 pending 事件 */
  @Cron('*/5 * * * * *')
  async flush() {
    try {
      const events = await this.outbox.poll(10);
      if (events.length === 0) return;

      for (const event of events) {
        try {
          await this.dispatch(event);
          await this.outbox.ack(event.id);
        } catch (err: any) {
          this.logger.warn(`[outbox] dispatch ${event.event_type}:${event.aggregate_id} failed: ${err.message}`);
          await this.outbox.nack(event.id, err.message ?? 'unknown');
        }
      }
    } catch (err: any) {
      // poll 本身失败（DB 异常），下次 cron 会重试
      this.logger.error(`[outbox] flush failed: ${err.message}`);
    }
  }

  private async dispatch(event: { id: number; event_type: string; aggregate_type: string; aggregate_id: string; payload: Record<string, unknown> }) {
    const orderId = Number(event.aggregate_id);
    if (!orderId || isNaN(orderId)) throw new Error('invalid aggregate_id');

    switch (event.event_type) {
      case 'ORDER_CREATED': {
        const order = await this.ordersService.getOrderById(orderId);
        this.ordersGateway.notifyOrderStatusChange(order.table_id, order);
        this.ordersGateway.notifyAllAdmins('orderStatusChanged', order);
        void this.notifDispatcher.notifyOrderEvent('NEW_ORDER', orderId);
        break;
      }
      case 'ORDER_ADD_MORE': {
        const order = await this.ordersService.getOrderById(orderId);
        this.ordersGateway.notifyTableUpdate(order.table_id, order);
        this.ordersGateway.notifyOrderUpdate(orderId, order);
        this.ordersGateway.notifyAllAdmins('orderUpdated', order);
        void this.notifDispatcher.notifyOrderEvent('ADD_ITEM', orderId);
        break;
      }
      case 'ORDER_SETTLED': {
        const order = await this.ordersService.getOrderById(orderId);
        this.ordersGateway.notifyOrderStatusChange(order.table_id, order);
        this.ordersGateway.notifyAllAdmins('orderStatusChanged', order);
        break;
      }
      default:
        this.logger.warn(`[outbox] unknown event type: ${event.event_type}`);
    }
  }
}
