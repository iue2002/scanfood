-- ============================================================
-- 0007_idempotency_keys.sql
-- P0-4：订单/加菜/结账 MySQL 幂等表
--
-- 设计要点：
--   - (scope, idempotency_key) 联合唯一，同一业务域内幂等
--   - request_hash 用于检测同 key 不同内容的冲突（返回 409）
--   - response_json 缓存成功结果，重复请求返回相同结果
--   - expired_at 支持定期清理过期 key
--
-- 索引：
--   - uk_scope_key: 幂等查询主索引
--   - idx_expires_at: 清理过期行
--   - idx_actor_created: 按用户维度查询
-- ============================================================

CREATE TABLE IF NOT EXISTS `idempotency_keys` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `scope` VARCHAR(64) NOT NULL COMMENT '业务域：order:create / order:add-more / order:status / order:item-served',
  `idempotency_key` VARCHAR(128) NOT NULL COMMENT '客户端生成的幂等键',
  `actor_user_id` INT NULL COMMENT '操作人 user_id',
  `request_hash` VARCHAR(64) NOT NULL COMMENT '请求体摘要（用于冲突检测）',
  `response_json` JSON NULL COMMENT '成功响应的缓存',
  `status` VARCHAR(20) NOT NULL DEFAULT 'processing' COMMENT 'processing | success | failed | conflict',
  `locked_until` TIMESTAMP NULL COMMENT '处理中锁到期时间（防并发重复处理）',
  `expires_at` TIMESTAMP NOT NULL COMMENT '过期时间（默认 24h）',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scope_key` (`scope`, `idempotency_key`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_actor_created` (`actor_user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
