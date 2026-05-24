-- merchant-ops M6：孤儿资源治理（FK 级联策略 + 索引补足）
-- 此迁移 idempotent：所有 ALTER 都先 DROP 再 ADD（先用变量探测）

-- =============================================================
-- 1. printer_configs.template_id 改为 ON DELETE SET NULL
--    原行为是 NO ACTION（删模板被引用就报错），改为 SET NULL：
--    删除模板时关联的打印机自动回退到默认模板（id=1）
-- =============================================================
ALTER TABLE `printer_configs`
  DROP FOREIGN KEY `printer_configs_template_id_print_templates_id_fk`;

ALTER TABLE `printer_configs`
  ADD CONSTRAINT `printer_configs_template_id_print_templates_id_fk`
    FOREIGN KEY (`template_id`) REFERENCES `print_templates`(`id`)
    ON DELETE SET NULL ON UPDATE NO ACTION;

-- =============================================================
-- 2. print_jobs.template_id 改为 ON DELETE SET NULL
--    任务保留历史，但模板删了就解引用
-- =============================================================
ALTER TABLE `print_jobs`
  DROP FOREIGN KEY `print_jobs_template_id_print_templates_id_fk`;

ALTER TABLE `print_jobs`
  ADD CONSTRAINT `print_jobs_template_id_print_templates_id_fk`
    FOREIGN KEY (`template_id`) REFERENCES `print_templates`(`id`)
    ON DELETE SET NULL ON UPDATE NO ACTION;

-- =============================================================
-- 3. 加 audit_logs_archive 的可清理索引（archived_at 上）
--    M2 已有 created_at + action 索引，再加 archived_at 便于清理
-- =============================================================
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE table_schema = DATABASE()
    AND table_name = 'audit_logs_archive'
    AND index_name = 'audit_archive_archived_at_idx'
);
SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX `audit_archive_archived_at_idx` ON `audit_logs_archive` (`archived_at`)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
