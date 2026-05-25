-- 多通道通知扩展（Web Push + Email）
-- 设计原则：
--   1. 仅 ADD COLUMN / CREATE TABLE，绝不改原列（红线）
--   2. 业务表 store_settings / user_preferences 仅扩展不破坏
--   3. 新增独立表 push_subscriptions
--
-- 注：不用 IF NOT EXISTS（MySQL 8 不支持 ALTER ADD COLUMN IF NOT EXISTS），
-- 也不用存储过程（mysql cli 输入流没有 DELIMITER 概念）。
-- 重跑会因为列已存在报错，没关系——首次运行能跑通就行。

-- ===== Web Push 订阅表 =====
CREATE TABLE IF NOT EXISTS `push_subscriptions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `endpoint` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `p256dh` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `auth` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_agent` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_used_at` timestamp NULL DEFAULT NULL,
  `failed_count` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `push_subs_endpoint_uniq` (`endpoint`(255)),
  KEY `push_subs_user_id_idx` (`user_id`),
  KEY `push_subs_failed_count_idx` (`failed_count`),
  CONSTRAINT `push_subs_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== store_settings: SMTP 配置（双模式：platform / custom）=====
ALTER TABLE `store_settings` ADD COLUMN `smtp_mode` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'platform' COMMENT 'platform=用平台默认; custom=自定义';
ALTER TABLE `store_settings` ADD COLUMN `smtp_host` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE `store_settings` ADD COLUMN `smtp_port` int DEFAULT NULL;
ALTER TABLE `store_settings` ADD COLUMN `smtp_user` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE `store_settings` ADD COLUMN `smtp_pass_enc` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE `store_settings` ADD COLUMN `smtp_from` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
ALTER TABLE `store_settings` ADD COLUMN `smtp_secure` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否走 SSL/TLS';

-- ===== user_preferences: 邮件通知配置（每个员工独立）=====
ALTER TABLE `user_preferences` ADD COLUMN `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '接收订单通知的邮箱';
ALTER TABLE `user_preferences` ADD COLUMN `email_events` json DEFAULT NULL COMMENT '订阅哪些事件: subset of {NEW_ORDER, ADD_ITEM, REFUND}';
