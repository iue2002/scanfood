-- 0011_orders_composite_indexes.sql
-- 针对性数据库索引优化（仅 ADD INDEX，不改既有列/类型，符合红线）
--
-- 背景：orders / refunds 是早期核心表，只有单列索引。但实际高频查询都是
-- 「等值 + 范围」或「多等值」组合，单列索引一次只能用一个，效率差：
--   - statistics 全部聚合：WHERE status='settled' AND created_at BETWEEN ...
--   - getOrders 列表筛选：WHERE status=? AND created_at ...
--   - getTableCurrentOrder/桌台看板：WHERE table_id=? AND status IN (活跃态)
--   - getMyActiveOrder：WHERE user_id=? AND status IN (活跃态)
--   - createRefund 累计额度：WHERE order_id=? AND status IN ('pending','approved')
-- 复合索引让这些查询走索引下推，数据量上量后避免全表扫描。
--
-- 幂等：MySQL 8 不支持 CREATE INDEX IF NOT EXISTS，用存储过程查 information_schema
-- 判断索引是否已存在，重跑无副作用（不会报 1061 duplicate key）。

DELIMITER $$

DROP PROCEDURE IF EXISTS `add_index_if_absent` $$
CREATE PROCEDURE `add_index_if_absent`(
  IN p_table   VARCHAR(64),
  IN p_index   VARCHAR(64),
  IN p_cols    VARCHAR(255)
)
BEGIN
  DECLARE idx_count INT DEFAULT 0;
  SELECT COUNT(*) INTO idx_count
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name   = p_table
    AND index_name   = p_index;
  IF idx_count = 0 THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` (', p_cols, ')');
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$

DELIMITER ;

-- orders：等值 + 范围 / 多等值复合索引
CALL add_index_if_absent('orders', 'orders_status_created_idx', '`status`, `created_at`');
CALL add_index_if_absent('orders', 'orders_table_status_idx',   '`table_id`, `status`');
CALL add_index_if_absent('orders', 'orders_user_status_idx',    '`user_id`, `status`');

-- refunds：按订单聚合可退额度（order_id + status）
CALL add_index_if_absent('refunds', 'refunds_order_status_idx', '`order_id`, `status`');

DROP PROCEDURE IF EXISTS `add_index_if_absent`;
