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
CREATE TABLE `audit_logs_archive` (
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
CREATE TABLE `carts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`table_id` int NOT NULL,
	`user_id` int,
	`total_amount` decimal(10,2) NOT NULL DEFAULT '0',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `carts_id` PRIMARY KEY(`id`)
);
CREATE TABLE `dish_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(50) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dish_categories_id` PRIMARY KEY(`id`)
);
CREATE TABLE `dish_specs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`dish_id` int NOT NULL,
	`spec_name` varchar(20) NOT NULL,
	`price` decimal(10,2) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dish_specs_id` PRIMARY KEY(`id`)
);
CREATE TABLE `dishes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category_id` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` varchar(500),
	`image_url` varchar(500),
	`price` decimal(10,2) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'available',
	`is_required` boolean NOT NULL DEFAULT false,
	`min_quantity` int NOT NULL DEFAULT 1,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dishes_id` PRIMARY KEY(`id`)
);
CREATE TABLE `export_jobs` (
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
	`completed_at` timestamp,
	CONSTRAINT `export_jobs_id` PRIMARY KEY(`id`)
);
CREATE TABLE `health_check` (
	`id` int AUTO_INCREMENT NOT NULL,
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `health_check_id` PRIMARY KEY(`id`)
);
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
CREATE TABLE `order_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`dish_id` int NOT NULL,
	`spec_id` int,
	`dish_name` varchar(100) NOT NULL,
	`spec_name` varchar(20),
	`quantity` int NOT NULL DEFAULT 1,
	`price` decimal(10,2) NOT NULL,
	`subtotal` decimal(10,2) NOT NULL,
	`added_by_user_id` int,
	`added_by_nickname` varchar(100),
	`phase` varchar(20) NOT NULL DEFAULT 'order',
	`add_more_round` int NOT NULL DEFAULT 0,
	`served_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`table_id` int NOT NULL,
	`order_number` varchar(50) NOT NULL,
	`total_amount` decimal(10,2) NOT NULL DEFAULT '0',
	`status` varchar(20) NOT NULL DEFAULT 'submitted',
	`order_type` varchar(20) NOT NULL DEFAULT 'dine_in',
	`user_id` int,
	`remark` varchar(500),
	`printed_at` timestamp,
	`settled_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_order_number_unique` UNIQUE(`order_number`)
);
CREATE TABLE `print_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`printer_id` int NOT NULL,
	`template_id` int,
	`plan_id` int,
	`order_id` int,
	`trigger` varchar(20) NOT NULL DEFAULT 'NEW_ORDER',
	`payload_json` json NOT NULL,
	`selected_item_ids` json,
	`status` varchar(16) NOT NULL DEFAULT 'PENDING',
	`attempt` int NOT NULL DEFAULT 0,
	`last_error` varchar(500),
	`next_retry_at` timestamp,
	`provider_job_id` varchar(100),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completed_at` timestamp,
	CONSTRAINT `print_jobs_id` PRIMARY KEY(`id`)
);
CREATE TABLE `print_plan_slices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`plan_id` int NOT NULL,
	`printer_id` int NOT NULL,
	`template_id` int,
	`printer_role_snapshot` varchar(16) NOT NULL DEFAULT 'BOTH',
	`category_ids` json,
	`label` varchar(100) NOT NULL DEFAULT '',
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `print_plan_slices_id` PRIMARY KEY(`id`)
);
CREATE TABLE `print_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`is_default_dine_in` boolean NOT NULL DEFAULT false,
	`is_default_takeaway` boolean NOT NULL DEFAULT false,
	`is_system_default` boolean NOT NULL DEFAULT false,
	`description` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `print_plans_id` PRIMARY KEY(`id`)
);
CREATE TABLE `print_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`error_message` varchar(500),
	`printed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `print_records_id` PRIMARY KEY(`id`)
);
CREATE TABLE `print_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`fields_json` json NOT NULL,
	`width` varchar(8) NOT NULL DEFAULT '80mm',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `print_templates_id` PRIMARY KEY(`id`)
);
CREATE TABLE `printer_configs` (
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
	`last_online_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `printer_configs_id` PRIMARY KEY(`id`)
);
CREATE TABLE `refunds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`order_id` int NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`reason` varchar(500) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`operator_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `refunds_id` PRIMARY KEY(`id`)
);
CREATE TABLE `store_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`store_name` varchar(100) NOT NULL DEFAULT '伊美�?,
	`store_avatar` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `store_settings_id` PRIMARY KEY(`id`)
);
CREATE TABLE `table_validations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`table_number` varchar(20) NOT NULL,
	`table_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `table_validations_id` PRIMARY KEY(`id`),
	CONSTRAINT `table_validations_table_number_unique` UNIQUE(`table_number`)
);
CREATE TABLE `tables` (
	`id` int AUTO_INCREMENT NOT NULL,
	`table_number` varchar(20) NOT NULL,
	`capacity` int NOT NULL DEFAULT 4,
	`status` varchar(20) NOT NULL DEFAULT 'idle',
	`qr_code_url` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tables_id` PRIMARY KEY(`id`),
	CONSTRAINT `tables_table_number_unique` UNIQUE(`table_number`)
);
CREATE TABLE `user_preferences` (
	`user_id` int NOT NULL,
	`sound_enabled` boolean NOT NULL DEFAULT true,
	`sound_id` varchar(64) NOT NULL DEFAULT 'default',
	`desktop_events` json NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_preferences_user_id` PRIMARY KEY(`user_id`)
);
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(50) NOT NULL,
	`password` varchar(255) NOT NULL,
	`role` varchar(20) NOT NULL DEFAULT 'customer',
	`openid` varchar(100),
	`nickname` varchar(100),
	`avatar_url` varchar(500),
	`table_number` varchar(20),
	`token_version` int NOT NULL DEFAULT 0,
	`must_change_password` boolean NOT NULL DEFAULT false,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`deleted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_cart_id_carts_id_fk` FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON DELETE cascade ON UPDATE no action;ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_dish_id_dishes_id_fk` FOREIGN KEY (`dish_id`) REFERENCES `dishes`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_spec_id_dish_specs_id_fk` FOREIGN KEY (`spec_id`) REFERENCES `dish_specs`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_added_by_user_id_users_id_fk` FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `carts` ADD CONSTRAINT `carts_table_id_tables_id_fk` FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `carts` ADD CONSTRAINT `carts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `dish_specs` ADD CONSTRAINT `dish_specs_dish_id_dishes_id_fk` FOREIGN KEY (`dish_id`) REFERENCES `dishes`(`id`) ON DELETE cascade ON UPDATE no action;ALTER TABLE `dishes` ADD CONSTRAINT `dishes_category_id_dish_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `dish_categories`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `export_jobs` ADD CONSTRAINT `export_jobs_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;ALTER TABLE `order_items` ADD CONSTRAINT `order_items_dish_id_dishes_id_fk` FOREIGN KEY (`dish_id`) REFERENCES `dishes`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `order_items` ADD CONSTRAINT `order_items_spec_id_dish_specs_id_fk` FOREIGN KEY (`spec_id`) REFERENCES `dish_specs`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `order_items` ADD CONSTRAINT `order_items_added_by_user_id_users_id_fk` FOREIGN KEY (`added_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `orders` ADD CONSTRAINT `orders_table_id_tables_id_fk` FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `print_jobs` ADD CONSTRAINT `print_jobs_printer_id_printer_configs_id_fk` FOREIGN KEY (`printer_id`) REFERENCES `printer_configs`(`id`) ON DELETE cascade ON UPDATE no action;ALTER TABLE `print_jobs` ADD CONSTRAINT `print_jobs_template_id_print_templates_id_fk` FOREIGN KEY (`template_id`) REFERENCES `print_templates`(`id`) ON DELETE set null ON UPDATE no action;ALTER TABLE `print_plan_slices` ADD CONSTRAINT `print_plan_slices_plan_id_print_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `print_plans`(`id`) ON DELETE cascade ON UPDATE no action;ALTER TABLE `print_plan_slices` ADD CONSTRAINT `print_plan_slices_printer_id_printer_configs_id_fk` FOREIGN KEY (`printer_id`) REFERENCES `printer_configs`(`id`) ON DELETE cascade ON UPDATE no action;ALTER TABLE `print_plan_slices` ADD CONSTRAINT `print_plan_slices_template_id_print_templates_id_fk` FOREIGN KEY (`template_id`) REFERENCES `print_templates`(`id`) ON DELETE set null ON UPDATE no action;ALTER TABLE `print_records` ADD CONSTRAINT `print_records_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `printer_configs` ADD CONSTRAINT `printer_configs_template_id_print_templates_id_fk` FOREIGN KEY (`template_id`) REFERENCES `print_templates`(`id`) ON DELETE set null ON UPDATE no action;ALTER TABLE `refunds` ADD CONSTRAINT `refunds_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `refunds` ADD CONSTRAINT `refunds_operator_id_users_id_fk` FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;ALTER TABLE `table_validations` ADD CONSTRAINT `table_validations_table_id_tables_id_fk` FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON DELETE cascade ON UPDATE no action;ALTER TABLE `user_preferences` ADD CONSTRAINT `user_preferences_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_user_id`,`created_at`);CREATE INDEX `audit_logs_action_created_idx` ON `audit_logs` (`action`,`created_at`);CREATE INDEX `audit_logs_target_idx` ON `audit_logs` (`target_type`,`target_id`);CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);CREATE INDEX `audit_archive_created_idx` ON `audit_logs_archive` (`created_at`);CREATE INDEX `audit_archive_action_idx` ON `audit_logs_archive` (`action`);CREATE INDEX `cart_items_cart_id_idx` ON `cart_items` (`cart_id`);CREATE INDEX `cart_items_dish_id_idx` ON `cart_items` (`dish_id`);CREATE INDEX `cart_items_added_by_user_id_idx` ON `cart_items` (`added_by_user_id`);CREATE INDEX `carts_table_id_idx` ON `carts` (`table_id`);CREATE INDEX `carts_user_id_idx` ON `carts` (`user_id`);CREATE INDEX `carts_updated_at_idx` ON `carts` (`updated_at`);CREATE INDEX `dish_categories_sort_order_idx` ON `dish_categories` (`sort_order`);CREATE INDEX `dish_specs_dish_id_idx` ON `dish_specs` (`dish_id`);CREATE INDEX `dishes_category_id_idx` ON `dishes` (`category_id`);CREATE INDEX `dishes_status_idx` ON `dishes` (`status`);CREATE INDEX `dishes_is_required_idx` ON `dishes` (`is_required`);CREATE INDEX `dishes_sort_order_idx` ON `dishes` (`sort_order`);CREATE INDEX `export_jobs_actor_idx` ON `export_jobs` (`actor_user_id`);CREATE INDEX `export_jobs_status_idx` ON `export_jobs` (`status`);CREATE INDEX `export_jobs_created_idx` ON `export_jobs` (`created_at`);CREATE INDEX `login_logs_user_id_idx` ON `login_logs` (`user_id`);CREATE INDEX `login_logs_username_idx` ON `login_logs` (`username`);CREATE INDEX `login_logs_created_at_idx` ON `login_logs` (`created_at`);CREATE INDEX `order_items_order_id_idx` ON `order_items` (`order_id`);CREATE INDEX `order_items_dish_id_idx` ON `order_items` (`dish_id`);CREATE INDEX `order_items_added_by_user_id_idx` ON `order_items` (`added_by_user_id`);CREATE INDEX `orders_table_id_idx` ON `orders` (`table_id`);CREATE INDEX `orders_order_number_idx` ON `orders` (`order_number`);CREATE INDEX `orders_status_idx` ON `orders` (`status`);CREATE INDEX `orders_user_id_idx` ON `orders` (`user_id`);CREATE INDEX `orders_created_at_idx` ON `orders` (`created_at`);CREATE INDEX `print_jobs_printer_status_idx` ON `print_jobs` (`printer_id`,`status`);CREATE INDEX `print_jobs_status_retry_idx` ON `print_jobs` (`status`,`next_retry_at`);CREATE INDEX `print_jobs_order_idx` ON `print_jobs` (`order_id`);CREATE INDEX `print_jobs_created_idx` ON `print_jobs` (`created_at`);CREATE INDEX `print_plan_slices_plan_idx` ON `print_plan_slices` (`plan_id`);CREATE INDEX `print_plan_slices_printer_idx` ON `print_plan_slices` (`printer_id`);CREATE INDEX `print_plans_default_dine_in_idx` ON `print_plans` (`is_default_dine_in`);CREATE INDEX `print_plans_default_takeaway_idx` ON `print_plans` (`is_default_takeaway`);CREATE INDEX `print_plans_system_idx` ON `print_plans` (`is_system_default`);CREATE INDEX `print_records_order_id_idx` ON `print_records` (`order_id`);CREATE INDEX `print_records_status_idx` ON `print_records` (`status`);CREATE INDEX `printer_configs_provider_idx` ON `printer_configs` (`provider`);CREATE INDEX `printer_configs_enabled_idx` ON `printer_configs` (`enabled`);CREATE INDEX `refunds_order_id_idx` ON `refunds` (`order_id`);CREATE INDEX `refunds_status_idx` ON `refunds` (`status`);CREATE INDEX `table_validations_table_number_idx` ON `table_validations` (`table_number`);CREATE INDEX `table_validations_table_id_idx` ON `table_validations` (`table_id`);CREATE INDEX `tables_table_number_idx` ON `tables` (`table_number`);CREATE INDEX `tables_status_idx` ON `tables` (`status`);CREATE INDEX `users_username_idx` ON `users` (`username`);CREATE INDEX `users_role_idx` ON `users` (`role`);CREATE INDEX `users_openid_idx` ON `users` (`openid`);CREATE INDEX `users_status_idx` ON `users` (`status`);CREATE INDEX `users_deleted_at_idx` ON `users` (`deleted_at`);