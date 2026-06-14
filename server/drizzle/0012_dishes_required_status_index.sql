-- 0012_dishes_required_status_index.sql
-- 为必选菜品查询加复合索引：WHERE is_required=true AND status='available'
-- 现有单列索引 dishes_is_required_idx / dishes_status_idx，MySQL 只能选一个，
-- 复合索引 (is_required, status) 覆盖该查询的全部条件，避免回表或全表扫描。

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

CALL add_index_if_absent('dishes', 'dishes_required_status_idx', '`is_required`, `status`');

DROP PROCEDURE IF EXISTS `add_index_if_absent`;
