-- merchant-ops M2：审计日志归档表
-- 主表 audit_logs 已在 0005 创建，这里只加归档表
CREATE TABLE IF NOT EXISTS `audit_logs_archive` (
    `id` bigint NOT NULL,
    `actor_user_id` int,
    `actor_role` varchar(20) NOT NULL,
    `action` varchar(64) NOT NULL,
    `target_type` varchar(32) NOT NULL,
    `target_id` varchar(64),
    `payload_json` json NOT NULL,
    `ip_address` varchar(45) NOT NULL,
    `user_agent` varchar(500) NOT NULL,
    `created_at` timestamp NOT NULL,
    `archived_at` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT `audit_logs_archive_id` PRIMARY KEY(`id`)
);
CREATE INDEX `audit_archive_created_idx` ON `audit_logs_archive` (`created_at`);
CREATE INDEX `audit_archive_action_idx` ON `audit_logs_archive` (`action`);
