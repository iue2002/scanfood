ALTER TABLE `users` ADD `must_change_password` boolean NOT NULL DEFAULT false;
ALTER TABLE `users` ADD `status` varchar(20) NOT NULL DEFAULT 'active';
ALTER TABLE `users` ADD `deleted_at` timestamp NULL;
CREATE INDEX `users_status_idx` ON `users` (`status`);
CREATE INDEX `users_deleted_at_idx` ON `users` (`deleted_at`);

CREATE TABLE IF NOT EXISTS `audit_logs` (
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
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_user_id`, `created_at`);
CREATE INDEX `audit_logs_action_created_idx` ON `audit_logs` (`action`, `created_at`);
CREATE INDEX `audit_logs_target_idx` ON `audit_logs` (`target_type`, `target_id`);
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);
