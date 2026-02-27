-- ============================================================================
-- Lifespan 数据库架构 - 回滚脚本
-- 此脚本将删除所有数据库对象，用于完全回滚初始迁移
-- ============================================================================

-- ============================================================================
-- 删除触发器
-- ============================================================================
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
DROP TRIGGER IF EXISTS update_devices_updated_at ON devices;
DROP TRIGGER IF EXISTS update_timelines_updated_at ON timelines;
DROP TRIGGER IF EXISTS update_user_portraits_updated_at ON user_portraits;
DROP TRIGGER IF EXISTS update_short_term_memory_updated_at ON short_term_memory;
DROP TRIGGER IF EXISTS update_long_term_memory_updated_at ON long_term_memory;
DROP TRIGGER IF EXISTS update_user_preferences_updated_at ON user_preferences;

-- ============================================================================
-- 删除视图
-- ============================================================================
DROP VIEW IF EXISTS user_overview CASCADE;
DROP VIEW IF EXISTS latest_user_portraits CASCADE;

-- ============================================================================
-- 删除函数
-- ============================================================================
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS create_monthly_partition(text, date) CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_partitions(text, integer) CASCADE;
DROP FUNCTION IF EXISTS get_user_events(UUID, TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS maintain_partitions() CASCADE;

-- ============================================================================
-- 删除表（按依赖关系顺序）
-- ============================================================================
-- 注意：分区表会自动删除所有分区
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS user_preferences CASCADE;
DROP TABLE IF EXISTS analysis_tasks CASCADE;
DROP TABLE IF EXISTS sync_records CASCADE;
DROP TABLE IF EXISTS long_term_memory CASCADE;
DROP TABLE IF EXISTS short_term_memory CASCADE;
DROP TABLE IF EXISTS working_memory CASCADE;
DROP TABLE IF EXISTS user_portraits CASCADE;
DROP TABLE IF EXISTS timelines CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================================================
-- 删除扩展
-- ============================================================================
-- 注意：扩展删除前需确保没有其他依赖
DROP EXTENSION IF EXISTS vector CASCADE;
DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;

-- ============================================================================
-- 成功消息
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '===========================================';
    RAISE NOTICE 'Lifespan Database Schema rolled back successfully!';
    RAISE NOTICE 'All database objects have been removed.';
    RAISE NOTICE '===========================================';
END $$;
