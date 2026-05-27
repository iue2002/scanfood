ALTER TABLE `orders` ADD COLUMN `pickup_no` int DEFAULT NULL COMMENT 'pickup number (takeaway)';
ALTER TABLE `store_settings` ADD COLUMN `pickup_reset_time` varchar(5) NOT NULL DEFAULT '00:00' COMMENT 'pickup number reset time (HH:mm)';

CREATE TABLE IF NOT EXISTS `daily_pickup_counters` (
  `biz_date` date NOT NULL,
  `current_no` int NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`biz_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
