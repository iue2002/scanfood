-- merchant-ops M3：用户通知偏好表（R9.1）
-- 与 users 1:1（user_id PK + cascade）
CREATE TABLE IF NOT EXISTS `user_preferences` (
    `user_id` int NOT NULL,
    `sound_enabled` boolean NOT NULL DEFAULT true,
    `sound_id` varchar(64) NOT NULL DEFAULT 'default',
    `desktop_events` json NOT NULL,
    `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `user_preferences_user_id` PRIMARY KEY(`user_id`),
    CONSTRAINT `user_preferences_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action
);
