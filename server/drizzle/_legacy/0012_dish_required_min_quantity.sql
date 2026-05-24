-- dishes 增量：必选 + 最少点餐数量（仅 ADD COLUMN，符合"既有表只能 ADD COLUMN"红线）
-- is_required: 商家可标记某菜品为"必选"——顾客提交订单时如未选会被拒
-- min_quantity: 最少点餐数量——选了该菜则数量必须 ≥ min_quantity（默认 1）

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'dishes'
    AND column_name = 'is_required'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `dishes` ADD COLUMN `is_required` boolean NOT NULL DEFAULT false AFTER `status`',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE table_schema = DATABASE()
    AND table_name = 'dishes'
    AND column_name = 'min_quantity'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `dishes` ADD COLUMN `min_quantity` int NOT NULL DEFAULT 1 AFTER `is_required`',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 给 is_required 加索引（提订单提交时校验快速查必选项）
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE table_schema = DATABASE()
    AND table_name = 'dishes'
    AND index_name = 'dishes_is_required_idx'
);
SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX `dishes_is_required_idx` ON `dishes` (`is_required`)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
