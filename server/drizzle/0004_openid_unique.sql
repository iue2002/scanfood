-- Enforce unique openid for WeChat users and dedupe existing rows.
-- Dev stage cleanup: keep the smallest user.id per openid and re-point references.

-- 1) Normalize empty openid to NULL to avoid unique conflicts
UPDATE `users` SET `openid` = NULL WHERE `openid` = '';

-- 2) Build mapping: openid -> keep_id (smallest id)
CREATE TEMPORARY TABLE `tmp_openid_keep` AS
SELECT `openid`, MIN(`id`) AS `keep_id`
FROM `users`
WHERE `openid` IS NOT NULL
GROUP BY `openid`;

CREATE TEMPORARY TABLE `tmp_openid_dupe` AS
SELECT u.`id` AS `old_id`, k.`keep_id`
FROM `users` u
JOIN `tmp_openid_keep` k ON u.`openid` = k.`openid`
WHERE u.`id` <> k.`keep_id`;

-- 3) Re-point foreign keys
UPDATE `orders` o
JOIN `tmp_openid_dupe` d ON o.`user_id` = d.`old_id`
SET o.`user_id` = d.`keep_id`;

UPDATE `order_items` oi
JOIN `tmp_openid_dupe` d ON oi.`added_by_user_id` = d.`old_id`
SET oi.`added_by_user_id` = d.`keep_id`;

UPDATE `carts` c
JOIN `tmp_openid_dupe` d ON c.`user_id` = d.`old_id`
SET c.`user_id` = d.`keep_id`;

UPDATE `cart_items` ci
JOIN `tmp_openid_dupe` d ON ci.`added_by_user_id` = d.`old_id`
SET ci.`added_by_user_id` = d.`keep_id`;

UPDATE `export_jobs` ej
JOIN `tmp_openid_dupe` d ON ej.`actor_user_id` = d.`old_id`
SET ej.`actor_user_id` = d.`keep_id`;

UPDATE `audit_logs` al
JOIN `tmp_openid_dupe` d ON al.`actor_user_id` = d.`old_id`
SET al.`actor_user_id` = d.`keep_id`;

UPDATE `audit_logs_archive` ala
JOIN `tmp_openid_dupe` d ON ala.`actor_user_id` = d.`old_id`
SET ala.`actor_user_id` = d.`keep_id`;

UPDATE `login_logs` ll
JOIN `tmp_openid_dupe` d ON ll.`user_id` = d.`old_id`
SET ll.`user_id` = d.`keep_id`;

UPDATE `refunds` r
JOIN `tmp_openid_dupe` d ON r.`operator_id` = d.`old_id`
SET r.`operator_id` = d.`keep_id`;

-- user_preferences: drop old rows; keep current keep_id row if any
DELETE up FROM `user_preferences` up
JOIN `tmp_openid_dupe` d ON up.`user_id` = d.`old_id`;

-- 4) Delete duplicate user rows
DELETE u FROM `users` u
JOIN `tmp_openid_dupe` d ON u.`id` = d.`old_id`;

-- 5) Add unique index on openid if missing
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND index_name = 'users_openid_unique'
);
SET @sql = IF(@idx_exists = 0,
  'CREATE UNIQUE INDEX `users_openid_unique` ON `users` (`openid`)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
