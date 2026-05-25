-- 多通道通知 - 群机器人（钉钉 / 企业微信 / 飞书）
-- 本迁移仅 CREATE TABLE，绝不改既有表（红线）

-- 群机器人配置表：店铺级（不区分员工），一行一个 provider
-- 当前业务一店一行，但用 (store_id, provider) 联合主键便于未来横向扩展
CREATE TABLE IF NOT EXISTS `robot_webhooks` (
  `id` int NOT NULL AUTO_INCREMENT,
  -- 当前 store_settings 是单行表，store_id 默认 1；保留字段便于未来支持多店
  `store_id` int NOT NULL DEFAULT 1,
  -- 'dingtalk' | 'wecom' | 'feishu'
  `provider` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  -- 是否启用此通道（关闭时不发，但保留配置）
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  -- AES-256-GCM 加密的 webhook URL（含 access_token，敏感不直存明文）
  `webhook_url_enc` varchar(1024) COLLATE utf8mb4_unicode_ci NOT NULL,
  -- 钉钉/飞书签名密钥；AES 加密；wecom 无签名留 NULL
  `secret_enc` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  -- 订阅事件 JSON 数组（'NEW_ORDER'/'ADD_ITEM'/'REFUND' 子集）
  `events_json` json NOT NULL,
  -- 最后一次发送时间（用于 UI 状态展示）
  `last_sent_at` timestamp NULL DEFAULT NULL,
  -- 最后一次错误（仅保留最新一条，便于排错）
  `last_error` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  -- 连续失败计数（>= 5 时 UI 显示告警）
  `failed_count` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_robot_store_provider` (`store_id`, `provider`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
