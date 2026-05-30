-- 0010_image_assets.sql
-- P1-5：上传安全加固 — image_assets 元数据表
-- 每次成功上传图片后写入一条记录，方便后续清理孤儿图片、审计和运营统计。
-- 同时为未来对象存储迁移提供统一的 asset 视图。

CREATE TABLE IF NOT EXISTS `image_assets` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `url` VARCHAR(500) NOT NULL,
  `thumbnail_url` VARCHAR(500) NULL,
  `mime` VARCHAR(100) NOT NULL COMMENT '原始上传 MIME（如 image/png）',
  `original_size_bytes` BIGINT NOT NULL COMMENT '原始上传文件字节数',
  `compressed_size_bytes` BIGINT NULL COMMENT '压缩后主图字节数（直传原图则为 NULL）',
  `main_width` INT NULL COMMENT '主图宽 px',
  `main_height` INT NULL COMMENT '主图高 px',
  `output_format` VARCHAR(10) NULL COMMENT '输出格式（webp 或原始扩展名）',
  `owner_user_id` INT NULL COMMENT '上传者用户 ID',
  `source` VARCHAR(20) NOT NULL DEFAULT 'upload' COMMENT '来源：upload｜compress-upload｜avatar｜qrcode',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL COMMENT '软删除时间（图片被清理时标记）',
  KEY `idx_owner` (`owner_user_id`),
  KEY `idx_source` (`source`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_deleted_at` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='上传图片资源元数据（P1-5 上传安全加固）';
