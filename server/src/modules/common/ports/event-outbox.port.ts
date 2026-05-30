/**
 * EventOutboxPort：事件投递箱抽象
 *
 * P1-1：保证通知/打印/WebSocket 事件不丢失
 * 当前 MySQL Adapter，未来可替换为 Redis Stream / RabbitMQ / Kafka
 */

export interface OutboxEvent {
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
}

export interface EventOutboxPort {
  /** 写入待处理事件（在业务事务内调用） */
  append(tx: unknown, event: OutboxEvent): Promise<void>;

  /** 拉取一批待处理事件 */
  poll(batchSize: number): Promise<Array<{ id: number } & OutboxEvent>>;

  /** 标记事件成功 */
  ack(eventId: number): Promise<void>;

  /** 标记事件失败（自动计算重试） */
  nack(eventId: number, error: string): Promise<void>;
}
