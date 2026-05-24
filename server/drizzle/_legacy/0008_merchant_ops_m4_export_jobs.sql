-- merchant-ops M4：导出任务表（R11.5/R11.6/R11.8）
CREATE TABLE IF NOT EXISTS `export_jobs` (
    `id` varchar(36) NOT NULL,
    `actor_user_id` int NOT NULL,
    `type` varchar(20) NOT NULL,
    `status` varchar(20) NOT NULL DEFAULT 'pending',
    `progress` int NOT NULL DEFAULT 0,
    `row_count` int,
    `file_path` varchar(500),
    `file_size` bigint,
    `file_name` varchar(200),
    `mime_type` varchar(100),
    `error_code` varchar(64),
    `error_message` varchar(500),
    `params_json` json,
    `created_at` timestamp NOT NULL DEFAULT (now()),
    `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    `completed_at` timestamp NULL,
    CONSTRAINT `export_jobs_id` PRIMARY KEY(`id`),
    CONSTRAINT `export_jobs_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`)
);
CREATE INDEX `export_jobs_actor_idx` ON `export_jobs` (`actor_user_id`);
CREATE INDEX `export_jobs_status_idx` ON `export_jobs` (`status`);
CREATE INDEX `export_jobs_created_idx` ON `export_jobs` (`created_at`);
