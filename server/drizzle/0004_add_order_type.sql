-- 增加 orders.order_type 字段，用于区分堂食 / 外带打包
ALTER TABLE `orders` ADD `order_type` varchar(20) NOT NULL DEFAULT 'dine_in';
