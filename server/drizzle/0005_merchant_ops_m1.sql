-- merchant-ops-center M1：员工与角色基础设施
-- 1. users 表扩展（仅 ADD COLUMN）
ALTER TABLE `users` ADD `token_version` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `users` ADD `must_change_password` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE `users` ADD `status` varchar(20) NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_at` timestamp NULL;
--> statement-breakpoint
CREATE INDEX `users_status_idx` ON `users` (`status`);
--> statement-breakpoint
CREATE INDEX `users_deleted_at_idx` ON `users` (`deleted_at`);
--> statement-breakpoint

-- 2. 审计日志表（M1 部分使用，M2 完善归档）
CREATE TABLE `audit_logs` (
    `id` bigint AUTO_INCREMENT NOT NULL,
    `actor_user_id` int,
    `actor_role` varchar(20) NOT NULL,
    `action` varchar(64) NOT NULL,
    `target_type` varchar(32) NOT NULL,
    `target_id` varchar(64),
    `payload_json` json NOT NULL,
    `ip_address` varchar(45) NOT NULL DEFAULT 'unknown',
    `user_agent` varchar(500) NOT NULL DEFAULT 'unknown',
    `created_at` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_user_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `audit_logs_action_created_idx` ON `audit_logs` (`action`, `created_at`);
--> statement-breakpoint
CREATE INDEX `audit_logs_target_idx` ON `audit_logs` (`target_type`, `target_id`);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);
