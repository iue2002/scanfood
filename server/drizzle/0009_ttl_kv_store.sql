-- ============================================================
-- 0009_ttl_kv_store.sql
-- P1-2：TTL 键值存储（MySQL 实现）
--
-- 替代内存 Map，服务重启后状态不丢：
--   - 验证码 token → captcha:{token}
--   - 登录失败计数 → login:attempts:{username}
--   - 账号锁定 → login:lock:{username}
--   - 短期限流 → ratelimit:{key}
--
-- 未来可无缝替换为 Redis（实现相同的 TtlStorePort 接口）
-- ============================================================

CREATE TABLE IF NOT EXISTS `ttl_kv_store` (
  `store_key` VARCHAR(191) NOT NULL COMMENT '键',
  `value_json` JSON NOT NULL COMMENT '值（JSON 格式）',
  `expires_at` TIMESTAMP NOT NULL COMMENT '过期时间',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`store_key`),
  KEY `idx_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
