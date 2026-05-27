-- 多通道通知 - 自定义消息模板
-- 店铺级配置：每 (event_type, channel) 一行，空时回退代码默认值
-- 变量语法 {{variableName}}，发送时替换为实际值
CREATE TABLE IF NOT EXISTS `notification_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'NEW_ORDER | ADD_ITEM | REFUND',
  `channel` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'dingtalk | wecom | feishu | email',
  `title_template` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题/邮件主题',
  `body_template` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '主体：robot 用 markdown / email 用纯文本',
  `html_template` text COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '仅 email 通道可选 HTML',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` int NOT NULL COMMENT '最后修改人 user_id',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_notif_template_event_channel` (`event_type`, `channel`),
  CONSTRAINT `notif_templates_updated_by_fk` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
