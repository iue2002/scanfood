-- 购物车并发安全：乐观锁 + 唯一索引

-- carts 表加 version 字段（乐观锁，防止并发覆盖）
ALTER TABLE `carts` ADD COLUMN `version` INT NOT NULL DEFAULT 0;

-- cart_items 表加唯一索引（防止并发 add 同一菜品插入重复记录）
ALTER TABLE `cart_items` ADD UNIQUE KEY `uk_cart_dish` (`cart_id`, `dish_id`);
