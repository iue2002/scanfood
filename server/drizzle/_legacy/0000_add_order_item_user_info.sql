ALTER TABLE `order_items` ADD COLUMN `added_by_user_id` int;
--> statement-breakpoint
ALTER TABLE `order_items` ADD COLUMN `added_by_nickname` varchar(100);
--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_added_by_user_id_users_id_fk` FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `order_items_added_by_user_id_idx` ON `order_items` (`added_by_user_id`);