-- ============================================================
-- 0008_event_outbox.sql
-- P1-1：事件投递箱（outbox pattern）
--
-- 保证通知/打印/WebSocket 事件不丢失：
--   事务内写事件 → 事务外消费 → 失败可重试
--
-- 事件类型：
--   ORDER_CREATED   → 新订单通知 + 自动打印
--   ORDER_ADD_MORE  → 加菜通知 + 打印新菜品
--   ORDER_SETTLED   → 结账通知 + 释放桌台通知
--   ORDER_ITEM_SERVED → 上菜通知
--   REFUND_CREATED  → 退款通知
-- ============================================================

CREATE TABLE IF NOT EXISTS `event_outbox` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `event_type` VARCHAR(64) NOT NULL COMMENT 'ORDER_CREATED | ORDER_ADD_MORE | ORDER_SETTLED | ORDER_ITEM_SERVED | REFUND_CREATED',
  `aggregate_type` VARCHAR(64) NOT NULL COMMENT 'order | refund',
  `aggregate_id` VARCHAR(64) NOT NULL COMMENT '订单/退款 ID',
  `payload_json` JSON NOT NULL COMMENT '事件负载（orderId, tableId 等）',
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending | processing | success | failed',
  `attempts` INT NOT NULL DEFAULT 0 COMMENT '已尝试次数',
  `next_retry_at` TIMESTAMP NULL COMMENT '下次重试时间',
  `last_error` VARCHAR(500) NULL COMMENT '最近一次错误信息',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at` TIMESTAMP NULL COMMENT '成功处理时间',
  PRIMARY KEY (`id`),
  KEY `idx_status_retry` (`status`, `next_retry_at`),
  KEY `idx_aggregate` (`aggregate_type`, `aggregate_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
