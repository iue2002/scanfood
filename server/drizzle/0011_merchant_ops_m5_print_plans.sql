-- merchant-ops M5 增量：高度定制化打印方案
-- 设计要点：
-- 1) 分类引用用 id（不存名）：商家改名不影响，删分类由应用层级联清理
-- 2) 默认方案按订单类型分（dine_in / takeaway 各一个）
-- 3) 系统默认整单全票方案自动建 + 不可删（is_system_default=true）
-- 4) 选购打印不走 plan，靠 print_jobs.selected_item_ids 直接指定
-- 5) slice 存 printer_role_snapshot：商家改 printer.role 后能看到不一致提示

CREATE TABLE IF NOT EXISTS `print_plans` (
    `id` int AUTO_INCREMENT NOT NULL,
    `name` varchar(100) NOT NULL,
    `enabled` boolean NOT NULL DEFAULT true,
    `is_default_dine_in` boolean NOT NULL DEFAULT false,
    `is_default_takeaway` boolean NOT NULL DEFAULT false,
    `is_system_default` boolean NOT NULL DEFAULT false,
    `description` varchar(500),
    `created_at` timestamp NOT NULL DEFAULT (now()),
    `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    INDEX `print_plans_default_dine_in_idx` (`is_default_dine_in`),
    INDEX `print_plans_default_takeaway_idx` (`is_default_takeaway`),
    INDEX `print_plans_system_idx` (`is_system_default`),
    CONSTRAINT `print_plans_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `print_plan_slices` (
    `id` int AUTO_INCREMENT NOT NULL,
    `plan_id` int NOT NULL,
    `printer_id` int NOT NULL,
    `template_id` int,
    -- 角色快照：创建时从 printer_configs.role 拷一份；之后 printer 改 role 不会跟着变（避免悄悄改变行为）
    `printer_role_snapshot` varchar(16) NOT NULL DEFAULT 'BOTH',
    -- 分类过滤：JSON int[] (dish_categories.id)；NULL/[] = catch-all（接收所有分类，作为兜底切片）
    `category_ids` json,
    `label` varchar(100) NOT NULL DEFAULT '',
    `sort_order` int NOT NULL DEFAULT 0,
    `created_at` timestamp NOT NULL DEFAULT (now()),
    `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    INDEX `print_plan_slices_plan_idx` (`plan_id`),
    INDEX `print_plan_slices_printer_idx` (`printer_id`),
    CONSTRAINT `print_plan_slices_id` PRIMARY KEY(`id`),
    CONSTRAINT `print_plan_slices_plan_fk` FOREIGN KEY (`plan_id`) REFERENCES `print_plans`(`id`) ON DELETE cascade,
    CONSTRAINT `print_plan_slices_printer_fk` FOREIGN KEY (`printer_id`) REFERENCES `printer_configs`(`id`) ON DELETE cascade,
    CONSTRAINT `print_plan_slices_template_fk` FOREIGN KEY (`template_id`) REFERENCES `print_templates`(`id`) ON DELETE set null
);

-- 给 print_jobs 加 selected_item_ids（选购打印支持）
-- 注意 IF NOT EXISTS 在 ALTER TABLE 不支持，用 INFORMATION_SCHEMA 探测
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'print_jobs'
    AND column_name = 'selected_item_ids'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `print_jobs` ADD COLUMN `selected_item_ids` json NULL AFTER `payload_json`',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 给 print_jobs 加 plan_id（追溯哪个 plan 触发的）
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'print_jobs'
    AND column_name = 'plan_id'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `print_jobs` ADD COLUMN `plan_id` int NULL AFTER `template_id`',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 系统默认方案（自动建，不可删；id=1）
INSERT INTO `print_plans` (`id`, `name`, `enabled`, `is_default_dine_in`, `is_default_takeaway`, `is_system_default`, `description`)
VALUES (1, '系统默认 · 整单全票', true, true, true, true, '所有 enabled 打印机各打一份完整订单。商家未自定义方案时使用。')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `is_system_default` = VALUES(`is_system_default`);
