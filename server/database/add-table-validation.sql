-- 桌号验证表迁移
-- 用于扫码时验证桌号是否有效
-- 与 tables 表通过外键关联，删除桌台时自动级联删除

CREATE TABLE IF NOT EXISTS `table_validations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `table_number` varchar(20) NOT NULL,
  `table_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `table_number` (`table_number`),
  KEY `table_validations_table_id_idx` (`table_id`),
  CONSTRAINT `table_validations_table_id_foreign` FOREIGN KEY (`table_id`) REFERENCES `tables` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 初始化：将现有桌台的桌号同步到验证表
INSERT IGNORE INTO `table_validations` (`table_number`, `table_id`)
SELECT `table_number`, `id` FROM `tables`;
