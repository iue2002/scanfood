-- merchant-ops M5：云打印（R13/R14/R16/R17）
-- 此迁移完全 idempotent（重跑不会报错），可在已建表的环境二次执行
-- 索引内联到 CREATE TABLE 里以避免 CREATE INDEX 与既有索引冲突

CREATE TABLE IF NOT EXISTS `print_templates` (
    `id` int AUTO_INCREMENT NOT NULL,
    `name` varchar(100) NOT NULL,
    `fields_json` json NOT NULL,
    `width` varchar(8) NOT NULL DEFAULT '80mm',
    `created_at` timestamp NOT NULL DEFAULT (now()),
    `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `print_templates_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `printer_configs` (
    `id` int AUTO_INCREMENT NOT NULL,
    `name` varchar(100) NOT NULL,
    `provider` varchar(16) NOT NULL,
    `device_sn` varchar(64),
    `device_key_enc` varchar(512),
    `role` varchar(16) NOT NULL DEFAULT 'BOTH',
    `enabled` boolean NOT NULL DEFAULT true,
    `auto_print` boolean NOT NULL DEFAULT false,
    `auto_print_add_more` boolean NOT NULL DEFAULT false,
    `template_id` int,
    `last_online_at` timestamp NULL,
    `created_at` timestamp NOT NULL DEFAULT (now()),
    `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    INDEX `printer_configs_provider_idx` (`provider`),
    INDEX `printer_configs_enabled_idx` (`enabled`),
    CONSTRAINT `printer_configs_id` PRIMARY KEY(`id`),
    CONSTRAINT `printer_configs_template_id_print_templates_id_fk` FOREIGN KEY (`template_id`) REFERENCES `print_templates`(`id`)
);

CREATE TABLE IF NOT EXISTS `print_jobs` (
    `id` int AUTO_INCREMENT NOT NULL,
    `printer_id` int NOT NULL,
    `template_id` int,
    `order_id` int,
    `trigger` varchar(20) NOT NULL DEFAULT 'NEW_ORDER',
    `payload_json` json NOT NULL,
    `status` varchar(16) NOT NULL DEFAULT 'PENDING',
    `attempt` int NOT NULL DEFAULT 0,
    `last_error` varchar(500),
    `next_retry_at` timestamp NULL,
    `provider_job_id` varchar(100),
    `created_at` timestamp NOT NULL DEFAULT (now()),
    `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    `completed_at` timestamp NULL,
    INDEX `print_jobs_printer_status_idx` (`printer_id`, `status`),
    INDEX `print_jobs_status_retry_idx` (`status`, `next_retry_at`),
    INDEX `print_jobs_order_idx` (`order_id`),
    INDEX `print_jobs_created_idx` (`created_at`),
    CONSTRAINT `print_jobs_id` PRIMARY KEY(`id`),
    CONSTRAINT `print_jobs_printer_id_printer_configs_id_fk` FOREIGN KEY (`printer_id`) REFERENCES `printer_configs`(`id`) ON DELETE cascade,
    CONSTRAINT `print_jobs_template_id_print_templates_id_fk` FOREIGN KEY (`template_id`) REFERENCES `print_templates`(`id`)
);

-- 默认模板（idempotent：ON DUPLICATE KEY UPDATE 兜底重跑）
INSERT INTO `print_templates` (`id`, `name`, `fields_json`, `width`)
VALUES (1, '默认全票', JSON_ARRAY('STORE_NAME','TABLE_NUMBER','ORDER_NO','TIME','ITEMS','TOTAL','REMARK','OPERATOR'), '80mm')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `fields_json` = VALUES(`fields_json`), `width` = VALUES(`width`);

INSERT INTO `print_templates` (`id`, `name`, `fields_json`, `width`)
VALUES (2, '后厨简化', JSON_ARRAY('TABLE_NUMBER','ORDER_NO','ITEMS','REMARK','TIME'), '80mm')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `fields_json` = VALUES(`fields_json`), `width` = VALUES(`width`);
