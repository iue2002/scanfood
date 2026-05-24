CREATE TABLE `cart_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cart_id` int NOT NULL,
	`dish_id` int NOT NULL,
	`spec_id` int,
	`dish_name` varchar(100) NOT NULL,
	`spec_name` varchar(20),
	`quantity` int NOT NULL DEFAULT 1,
	`price` decimal(10,2) NOT NULL,
	`subtotal` decimal(10,2) NOT NULL,
	`added_by_user_id` int,
	`added_by_nickname` varchar(100),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cart_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `carts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`table_id` int NOT NULL,
	`user_id` int,
	`total_amount` decimal(10,2) NOT NULL DEFAULT '0',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `carts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `login_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`username` varchar(50) NOT NULL,
	`ip_address` varchar(45),
	`user_agent` varchar(500),
	`success` int NOT NULL DEFAULT 0,
	`failure_reason` varchar(100),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `login_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `store_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`store_name` varchar(100) NOT NULL DEFAULT '伊美轩',
	`store_avatar` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `table_validations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`table_number` varchar(20) NOT NULL,
	`table_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `table_validations_id` PRIMARY KEY(`id`),
	CONSTRAINT `table_validations_table_number_unique` UNIQUE(`table_number`)
);
--> statement-breakpoint
ALTER TABLE `order_items` ADD `served_at` timestamp;--> statement-breakpoint
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_cart_id_carts_id_fk` FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_dish_id_dishes_id_fk` FOREIGN KEY (`dish_id`) REFERENCES `dishes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_spec_id_dish_specs_id_fk` FOREIGN KEY (`spec_id`) REFERENCES `dish_specs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_added_by_user_id_users_id_fk` FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `carts` ADD CONSTRAINT `carts_table_id_tables_id_fk` FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `carts` ADD CONSTRAINT `carts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `table_validations` ADD CONSTRAINT `table_validations_table_id_tables_id_fk` FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `cart_items_cart_id_idx` ON `cart_items` (`cart_id`);--> statement-breakpoint
CREATE INDEX `cart_items_dish_id_idx` ON `cart_items` (`dish_id`);--> statement-breakpoint
CREATE INDEX `cart_items_added_by_user_id_idx` ON `cart_items` (`added_by_user_id`);--> statement-breakpoint
CREATE INDEX `carts_table_id_idx` ON `carts` (`table_id`);--> statement-breakpoint
CREATE INDEX `carts_user_id_idx` ON `carts` (`user_id`);--> statement-breakpoint
CREATE INDEX `carts_updated_at_idx` ON `carts` (`updated_at`);--> statement-breakpoint
CREATE INDEX `login_logs_user_id_idx` ON `login_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `login_logs_username_idx` ON `login_logs` (`username`);--> statement-breakpoint
CREATE INDEX `login_logs_created_at_idx` ON `login_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `table_validations_table_number_idx` ON `table_validations` (`table_number`);--> statement-breakpoint
CREATE INDEX `table_validations_table_id_idx` ON `table_validations` (`table_id`);