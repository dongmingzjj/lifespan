-- ============================================================================
-- Lifespan 数据库架构 - 初始化 Schema
-- PostgreSQL 16+ + pgvector
-- 版本: 1.0.0
-- 更新: 2026-02-26
-- ============================================================================

-- 启用必需的扩展
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 用户表
-- ============================================================================
CREATE TABLE users (
    -- 基本信息
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,

    -- 配置
    timezone VARCHAR(50) DEFAULT 'Asia/Shanghai',
    language VARCHAR(10) DEFAULT 'zh-CN',

    -- 加密配置
    public_key TEXT,
    encryption_version VARCHAR(20) DEFAULT 'v1',

    -- 状态
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_sync_at TIMESTAMP WITH TIME ZONE,

    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 用户表索引
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_is_active ON users(is_active);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- 用户表注释
COMMENT ON TABLE users IS '用户账户表，存储基本信息和配置';
COMMENT ON COLUMN users.public_key IS '用户公钥，用于端到端加密';
COMMENT ON COLUMN users.encryption_version IS '加密协议版本';

-- ============================================================================
-- 设备表
-- ============================================================================
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 设备信息
    device_name VARCHAR(100) NOT NULL,
    device_type VARCHAR(20) NOT NULL CHECK (device_type IN ('windows', 'android', 'ios', 'macos')),
    device_id VARCHAR(255) NOT NULL,

    -- 配置
    os_version VARCHAR(50),
    app_version VARCHAR(20),

    -- 状态
    is_active BOOLEAN DEFAULT true,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- 约束
    UNIQUE(user_id, device_id)
);

-- 设备表索引
CREATE INDEX idx_devices_user_id ON devices(user_id);
CREATE INDEX idx_devices_device_id ON devices(device_id);
CREATE INDEX idx_devices_user_active ON devices(user_id, is_active);

COMMENT ON TABLE devices IS '用户设备表，支持多设备管理';
COMMENT ON COLUMN devices.device_type IS '设备类型: windows, android, ios, macos';

-- ============================================================================
-- 事件表 (核心表 - 按月分区)
-- ============================================================================
CREATE TABLE events (
    -- 主键
    id UUID DEFAULT uuid_generate_v4(),

    -- 关联
    user_id UUID NOT NULL,
    device_id UUID NOT NULL,

    -- 事件类型
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('app_usage', 'web_activity', 'file_activity', 'communication')),

    -- 时间信息
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    duration INTEGER NOT NULL CHECK (duration >= 0),

    -- 加密数据
    encrypted_data BYTEA NOT NULL,
    iv VARCHAR(255) NOT NULL,
    auth_tag VARCHAR(255),

    -- 可搜索的明文信息（非敏感）
    app_name VARCHAR(255),
    category VARCHAR(50) CHECK (category IN ('work', 'communication', 'entertainment', 'learning', 'utility', 'other')),
    domain VARCHAR(255),

    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,

    -- 同步状态
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed BOOLEAN DEFAULT false,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- 主键约束（分区表需要定义主键）
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- 创建月度分区函数
CREATE OR REPLACE FUNCTION create_monthly_partition(table_name text, start_date date)
RETURNS void AS $$
DECLARE
    partition_name text;
    end_date date;
BEGIN
    partition_name := table_name || '_' || to_char(start_date, 'YYYY_MM');
    end_date := start_date + interval '1 month';

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        table_name,
        start_date,
        end_date
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_monthly_partition IS '创建月度分区，用于事件表';

-- 创建当前和未来3个月的分区
SELECT create_monthly_partition('events', date_trunc('month', CURRENT_DATE));
SELECT create_monthly_partition('events', date_trunc('month', CURRENT_DATE + interval '1 month'));
SELECT create_monthly_partition('events', date_trunc('month', CURRENT_DATE + interval '2 months'));
SELECT create_monthly_partition('events', date_trunc('month', CURRENT_DATE + interval '3 months'));

-- 事件表索引（每个分区自动继承）
CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_device_id ON events(device_id);
CREATE INDEX idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX idx_events_event_type ON events(event_type);
CREATE INDEX idx_events_category ON events(category);
CREATE INDEX idx_events_user_timestamp ON events(user_id, timestamp DESC);
CREATE INDEX idx_events_processed ON events(processed) WHERE processed = false;
CREATE INDEX idx_events_metadata ON events USING gin(metadata);

-- 复合索引用于常见查询
CREATE INDEX idx_events_user_type_timestamp ON events(user_id, event_type, timestamp DESC);
CREATE INDEX idx_events_user_category_timestamp ON events(user_id, category, timestamp DESC);

COMMENT ON TABLE events IS '事件表（按月分区），存储所有用户活动事件';
COMMENT ON COLUMN events.encrypted_data IS '加密的事件详情（端到端加密）';
COMMENT ON COLUMN events.processed IS '是否已被AI分析处理';

-- ============================================================================
-- 时间线表
-- ============================================================================
CREATE TABLE timelines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 时间范围
    date DATE NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,

    -- 统计数据
    total_duration INTEGER NOT NULL CHECK (total_duration >= 0),
    total_work_hours DECIMAL(5,2) DEFAULT 0 CHECK (total_work_hours >= 0),
    total_focus_hours DECIMAL(5,2) DEFAULT 0 CHECK (total_focus_hours >= 0),
    context_switches INTEGER DEFAULT 0 CHECK (context_switches >= 0),
    productivity_score DECIMAL(3,2) DEFAULT 0 CHECK (productivity_score BETWEEN 0 AND 1),

    -- 分类统计（JSONB格式）
    category_stats JSONB DEFAULT '{}'::jsonb,
    app_usage_stats JSONB DEFAULT '{}'::jsonb,

    -- 时间片段（JSONB格式）
    segments JSONB DEFAULT '[]'::jsonb,

    -- AI分析结果
    ai_insights TEXT,
    ai_generated_at TIMESTAMP WITH TIME ZONE,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- 约束
    UNIQUE(user_id, date)
);

-- 时间线表索引
CREATE INDEX idx_timelines_user_id ON timelines(user_id);
CREATE INDEX idx_timelines_date ON timelines(user_id, date DESC);
CREATE INDEX idx_timelines_productivity ON timelines(user_id, productivity_score DESC);
CREATE INDEX idx_timelines_category_stats ON timelines USING gin(category_stats);
CREATE INDEX idx_timelines_app_usage_stats ON timelines USING gin(app_usage_stats);

COMMENT ON TABLE timelines IS '每日时间线聚合表，存储预计算的统计数据';
COMMENT ON COLUMN timelines.productivity_score IS '生产力评分，范围0.00-1.00';

-- ============================================================================
-- 用户画像表
-- ============================================================================
CREATE TABLE user_portraits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 版本控制
    version INTEGER DEFAULT 1 CHECK (version > 0),
    previous_version_id UUID REFERENCES user_portraits(id),

    -- 画像数据（JSONB格式，与TypeScript类型定义对应）
    profile JSONB DEFAULT '{}'::jsonb,
    patterns JSONB DEFAULT '{}'::jsonb,
    interests JSONB DEFAULT '{}'::jsonb,
    habits JSONB DEFAULT '{}'::jsonb,
    relationships JSONB DEFAULT '{}'::jsonb,
    goals JSONB DEFAULT '{}'::jsonb,

    -- 向量嵌入（用于语义搜索和相似度计算）
    embedding vector(1536),

    -- 分析元数据
    data_points_count INTEGER DEFAULT 0 CHECK (data_points_count >= 0),
    confidence_score DECIMAL(3,2) DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 1),

    -- AI分析
    ai_model VARCHAR(50) DEFAULT 'glm-4',
    ai_insights TEXT,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- 约束
    UNIQUE(user_id, version)
);

-- 用户画像表索引
CREATE INDEX idx_user_portraits_user_id ON user_portraits(user_id);
CREATE INDEX idx_user_portraits_version ON user_portraits(user_id, version DESC);
CREATE INDEX idx_user_portraits_embedding ON user_portraits USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_user_portraits_profile ON user_portraits USING gin(profile);
CREATE INDEX idx_user_portraits_patterns ON user_portraits USING gin(patterns);

COMMENT ON TABLE user_portraits IS '用户画像表，存储AI生成的行为分析';
COMMENT ON COLUMN user_portraits.embedding IS '用户画像向量嵌入，用于语义搜索（1536维）';
COMMENT ON COLUMN user_portraits.confidence_score IS '置信度，范围0.00-1.00';

-- ============================================================================
-- 记忆系统表 (AI助理三层记忆)
-- ============================================================================

-- 工作记忆（短期，当前会话）
CREATE TABLE working_memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 记忆内容
    memory_type VARCHAR(50) NOT NULL CHECK (memory_type IN ('context', 'task', 'conversation')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,

    -- 过期时间
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 工作记忆索引
CREATE INDEX idx_working_memory_user_id ON working_memory(user_id);
CREATE INDEX idx_working_memory_expires_at ON working_memory(expires_at);
CREATE INDEX idx_working_memory_user_type ON working_memory(user_id, memory_type);

COMMENT ON TABLE working_memory IS 'AI工作记忆，存储当前会话上下文（短期）';

-- 短期记忆（天到周级别）
CREATE TABLE short_term_memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 记忆内容
    memory_type VARCHAR(50) NOT NULL CHECK (memory_type IN ('recent_activity', 'preference', 'pattern')),
    title VARCHAR(255),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,

    -- 重要性（0.0 - 1.0）
    importance DECIMAL(3,2) DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
    access_count INTEGER DEFAULT 0 CHECK (access_count >= 0),

    -- 向量嵌入
    embedding vector(1536),

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 短期记忆索引
CREATE INDEX idx_short_term_memory_user_id ON short_term_memory(user_id);
CREATE INDEX idx_short_term_memory_importance ON short_term_memory(importance DESC);
CREATE INDEX idx_short_term_memory_created_at ON short_term_memory(created_at DESC);
CREATE INDEX idx_short_term_memory_embedding ON short_term_memory USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);

COMMENT ON TABLE short_term_memory IS 'AI短期记忆，存储最近的活动和偏好（7-30天）';

-- 长期记忆（持久化，核心知识）
CREATE TABLE long_term_memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 记忆内容
    memory_type VARCHAR(50) NOT NULL CHECK (memory_type IN ('fact', 'preference', 'relationship', 'expertise')),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,

    -- 重要性（0.0 - 1.0）
    importance DECIMAL(3,2) DEFAULT 0.8 CHECK (importance BETWEEN 0 AND 1),

    -- 访问统计
    access_count INTEGER DEFAULT 0 CHECK (access_count >= 0),
    last_accessed_at TIMESTAMP WITH TIME ZONE,

    -- 向量嵌入（语义搜索）
    embedding vector(1536),

    -- 关联
    related_memories UUID[] DEFAULT ARRAY[]::UUID[],

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 长期记忆索引
CREATE INDEX idx_long_term_memory_user_id ON long_term_memory(user_id);
CREATE INDEX idx_long_term_memory_type ON long_term_memory(memory_type);
CREATE INDEX idx_long_term_memory_importance ON long_term_memory(importance DESC);
CREATE INDEX idx_long_term_memory_embedding ON long_term_memory USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_long_term_memory_content ON long_term_memory USING gin(to_tsvector('english', content));

COMMENT ON TABLE long_term_memory IS 'AI长期记忆，存储核心知识和持久化信息';
COMMENT ON COLUMN long_term_memory.related_memories IS '关联的其他记忆ID数组';

-- ============================================================================
-- 同步记录表
-- ============================================================================
CREATE TABLE sync_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,

    -- 同步信息
    sync_type VARCHAR(20) NOT NULL CHECK (sync_type IN ('upload', 'download', 'bidirectional')),
    events_count INTEGER DEFAULT 0 CHECK (events_count >= 0),
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'success', 'failed')),

    -- 数据范围
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,

    -- 错误信息
    error_message TEXT,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- 同步记录表索引
CREATE INDEX idx_sync_records_user_id ON sync_records(user_id);
CREATE INDEX idx_sync_records_device_id ON sync_records(device_id);
CREATE INDEX idx_sync_records_status ON sync_records(status);
CREATE INDEX idx_sync_records_created_at ON sync_records(created_at DESC);

COMMENT ON TABLE sync_records IS '跨设备同步记录表';

-- ============================================================================
-- AI分析任务队列表
-- ============================================================================
CREATE TABLE analysis_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 任务信息
    task_type VARCHAR(50) NOT NULL CHECK (task_type IN ('portrait_analysis', 'pattern_extraction', 'insight_generation')),
    priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),

    -- 输入数据
    input_data JSONB NOT NULL,

    -- 任务状态
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),

    -- 输出结果
    result JSONB,
    error_message TEXT,

    -- 重试机制
    retry_count INTEGER DEFAULT 0 CHECK (retry_count >= 0),
    max_retries INTEGER DEFAULT 3 CHECK (max_retries > 0),

    -- AI模型
    ai_model VARCHAR(50) DEFAULT 'glm-4-flash',

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,

    -- 约束（防止重复任务）
    UNIQUE(user_id, task_type, input_data)
);

-- AI任务表索引
CREATE INDEX idx_analysis_tasks_user_id ON analysis_tasks(user_id);
CREATE INDEX idx_analysis_tasks_status_priority ON analysis_tasks(status, priority DESC);
CREATE INDEX idx_analysis_tasks_created_at ON analysis_tasks(created_at);
CREATE INDEX idx_analysis_tasks_user_status ON analysis_tasks(user_id, status);

COMMENT ON TABLE analysis_tasks IS 'AI分析任务队列表';
COMMENT ON COLUMN analysis_tasks.priority IS '任务优先级，1-10，10最高';

-- ============================================================================
-- 用户偏好设置表
-- ============================================================================
CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 偏好设置
    preference_key VARCHAR(100) NOT NULL,
    preference_value JSONB NOT NULL,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- 约束
    UNIQUE(user_id, preference_key)
);

-- 用户偏好表索引
CREATE INDEX idx_user_preferences_user_id ON user_preferences(user_id);
CREATE INDEX idx_user_preferences_key ON user_preferences(preference_key);

COMMENT ON TABLE user_preferences IS '用户偏好设置表';

-- ============================================================================
-- 审计日志表
-- ============================================================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,

    -- 操作信息
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,

    -- 请求信息
    ip_address INET,
    user_agent TEXT,

    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 审计日志表索引
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

COMMENT ON TABLE audit_logs IS '审计日志表，用于安全审计和合规';

-- ============================================================================
-- 触发器和函数
-- ============================================================================

-- 自动更新 updated_at 字段
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column IS '自动更新updated_at时间戳的触发器函数';

-- 为需要的表添加触发器
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_devices_updated_at BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_timelines_updated_at BEFORE UPDATE ON timelines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_portraits_updated_at BEFORE UPDATE ON user_portraits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_short_term_memory_updated_at BEFORE UPDATE ON short_term_memory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_long_term_memory_updated_at BEFORE UPDATE ON long_term_memory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 视图
-- ============================================================================

-- 用户概览视图
CREATE VIEW user_overview AS
SELECT
    u.id,
    u.username,
    u.email,
    u.created_at,
    u.last_sync_at,
    COUNT(DISTINCT d.id) AS device_count,
    COUNT(DISTINCT e.id) AS total_events,
    MAX(e.timestamp) AS last_activity_at
FROM users u
LEFT JOIN devices d ON u.id = d.user_id AND d.is_active = true
LEFT JOIN events e ON u.id = e.user_id
WHERE u.is_active = true
GROUP BY u.id;

COMMENT ON VIEW user_overview IS '用户概览视图，包含设备和活动统计';

-- 最新用户画像视图
CREATE VIEW latest_user_portraits AS
SELECT DISTINCT ON (user_id)
    user_id,
    version,
    profile,
    patterns,
    interests,
    habits,
    relationships,
    goals,
    embedding,
    confidence_score,
    created_at,
    updated_at
FROM user_portraits
ORDER BY user_id, version DESC;

COMMENT ON VIEW latest_user_portraits IS '每个用户的最新画像视图';

-- ============================================================================
-- 清理旧分区函数
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_old_partitions(table_name text, retention_months integer DEFAULT 12)
RETURNS void AS $$
DECLARE
    partition_record RECORD;
    cutoff_date date;
BEGIN
    cutoff_date := CURRENT_DATE - (retention_months || ' months')::interval;

    FOR partition_record IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename LIKE (table_name || '_%')
        AND tablename ~ '^' || table_name || '_[0-9]{4}_[0-9]{2}$'
    LOOP
        -- 从分区名提取日期并检查是否需要删除
        IF substring(partition_record.tablename from length(table_name) + 2 for 7)::date < cutoff_date THEN
            RAISE NOTICE 'Dropping partition: %', partition_record.tablename;
            EXECUTE format('DROP TABLE IF EXISTS %I', partition_record.tablename);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_partitions IS '清理超过指定月数的旧分区，默认保留12个月';

-- ============================================================================
-- 获取用户事件函数（优化查询）
-- ============================================================================
CREATE OR REPLACE FUNCTION get_user_events(
    p_user_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_event_type VARCHAR DEFAULT NULL,
    p_limit INTEGER DEFAULT 100
) RETURNS TABLE (
    event_id UUID,
    event_type VARCHAR(50),
    event_timestamp TIMESTAMPTZ,
    duration INTEGER,
    app_name VARCHAR(255),
    category VARCHAR(50),
    domain VARCHAR(255)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.id AS event_id,
        e.event_type,
        e.timestamp AS event_timestamp,
        e.duration,
        e.app_name,
        e.category,
        e.domain
    FROM events e
    WHERE e.user_id = p_user_id
        AND e.timestamp >= p_start_date
        AND e.timestamp <= p_end_date
        AND (p_event_type IS NULL OR e.event_type = p_event_type)
    ORDER BY e.timestamp DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_user_events IS '获取指定用户的时间范围事件，支持分区裁剪优化';

-- ============================================================================
-- 创建分区维护任务函数
-- ============================================================================
CREATE OR REPLACE FUNCTION maintain_partitions()
RETURNS void AS $$
BEGIN
    -- 创建未来3个月的分区
    PERFORM create_monthly_partition('events', date_trunc('month', CURRENT_DATE));
    PERFORM create_monthly_partition('events', date_trunc('month', CURRENT_DATE + interval '1 month'));
    PERFORM create_monthly_partition('events', date_trunc('month', CURRENT_DATE + interval '2 months'));
    PERFORM create_monthly_partition('events', date_trunc('month', CURRENT_DATE + interval '3 months'));

    RAISE NOTICE 'Partition maintenance completed. Next run: in 1 month';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION maintain_partitions IS '创建未来3个月的分区，建议通过cron每月执行一次';

-- ============================================================================
-- 成功消息
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '===========================================';
    RAISE NOTICE 'Lifespan Database Schema initialized successfully!';
    RAISE NOTICE '===========================================';
    RAISE NOTICE 'Tables created: 11';
    RAISE NOTICE 'Indexes created: 45+';
    RAISE NOTICE 'Views created: 2';
    RAISE NOTICE 'Functions created: 5';
    RAISE NOTICE 'Triggers created: 8';
    RAISE NOTICE 'Partitions: Current + 3 months';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Create application user: CREATE ROLE lifes_user WITH LOGIN PASSWORD ''your_password'';';
    RAISE NOTICE '2. Grant permissions: GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO lifes_user;';
    RAISE NOTICE '3. Set up partition maintenance cron job';
    RAISE NOTICE '';
    RAISE NOTICE 'For more information, see: packages/database/README.md';
    RAISE NOTICE '===========================================';
END $$;
