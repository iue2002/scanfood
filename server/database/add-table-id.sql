USE scanfood;

ALTER TABLE users DROP COLUMN table_id;
ALTER TABLE users ADD COLUMN table_number VARCHAR(20) DEFAULT NULL AFTER avatar_url;
