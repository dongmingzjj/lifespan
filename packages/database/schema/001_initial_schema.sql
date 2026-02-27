-- ============================================================================
-- Lifespan 数据库架构
-- PostgreSQL + pgvector
-- 版本: 1.0.0
-- 更新: 2026-02-26
-- ============================================================================

-- 启用 pgvector 扩展
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
    public_key TEXT, -- 用户公钥（用于端到端加密）
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

-- ============================================================================
-- 设备表
-- ============================================================================
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 设备信息
    device_name VARCHAR(100) NOT NULL,
    device_type VARCHAR(20) NOT NULL, -- 'windows', 'android', 'ios', 'macos'
    device_id VARCHAR(255) NOT NULL, -- 设备唯一标识

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

-- ============================================================================
-- 事件表 (核心表 - 分区表)
-- ============================================================================
CREATE TABLE events (
    -- 主键
    id UUID DEFAULT uuid_generate_v4(),

    -- 关联
    user_id UUID NOT NULL,
    device_id UUID NOT NULL,

    -- 事件类型 (应用类型继承)
    event_type VARCHAR(50) NOT NULL, -- 'app_usage', 'web_activity', 'file_activity', 'communication'

    -- 时间信息
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    duration INTEGER NOT NULL, -- 持续时间（秒）

    -- 加密数据
    encrypted_data BYTEA NOT NULL, -- 加密的事件详情
    iv VARCHAR(255) NOT NULL, -- 初始化向量
    auth_tag VARCHAR(255), -- 认证标签

    -- 可搜索的明文信息（非敏感）
    app_name VARCHAR(255), -- 应用名称
    category VARCHAR(50), -- 'work', 'communication', 'entertainment', 'learning', 'utility', 'other'
    domain VARCHAR(255), -- 域名（仅域名，不含完整URL）

    -- 元数据
    metadata JSONB DEFAULT '{}'::jsonb,

    -- 同步状态
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed BOOLEAN DEFAULT false, -- 是否已被AI分析

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (timestamp);

-- 创建月度分区（保留3年数据）
-- 自动创建分区函数
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
    total_duration INTEGER NOT NULL, -- 总时长（秒）
    total_work_hours DECIMAL(5,2) DEFAULT 0,
    total_focus_hours DECIMAL(5,2) DEFAULT 0,
    context_switches INTEGER DEFAULT 0,
    productivity_score DECIMAL(3,2) DEFAULT 0, -- 0.00 - 1.00

    -- 分类统计（JSONB格式）
    category_stats JSONB DEFAULT '{}'::jsonb,
    app_usage_stats JSONB DEFAULT '{}'::jsonb,

    -- 时间片段（JSONB格式，存储详细的时间线）
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

-- ============================================================================
-- 用户画像表
-- ============================================================================
CREATE TABLE user_portraits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 版本控制
    version INTEGER DEFAULT 1,
    previous_version_id UUID REFERENCES user_portraits(id),

    -- 画像数据（JSONB格式，与TypeScript类型定义对应）
    profile JSONB DEFAULT '{}'::jsonb, -- UserProfile
    patterns JSONB DEFAULT '{}'::jsonb, -- UserPatterns
    interests JSONB DEFAULT '{}'::jsonb, -- UserInterests
    habits JSONB DEFAULT '{}'::jsonb, -- UserHabits
    relationships JSONB DEFAULT '{}'::jsonb, -- UserRelationships
    goals JSONB DEFAULT '{}'::jsonb, -- UserGoals

    -- 向量嵌入（用于语义搜索和相似度计算）
    embedding vector(1536), -- OpenAI embedding dimension

    -- 分析元数据
    data_points_count INTEGER DEFAULT 0, -- 基于多少事件数据生成
    confidence_score DECIMAL(3,2) DEFAULT 0, -- 0.00 - 1.00

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

-- ============================================================================
-- 记忆系统表 (AI助理三层记忆)
-- ============================================================================

-- 工作记忆（短期，当前会话）
CREATE TABLE working_memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 记忆内容
    memory_type VARCHAR(50) NOT NULL, -- 'context', 'task', 'conversation'
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,

    -- 过期时间
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- 索引
    INDEX idx_working_memory_user_id (user_id),
    INDEX idx_working_memory_expires_at (expires_at)
);

-- 短期记忆（天到周级别）
CREATE TABLE short_term_memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 记忆内容
    memory_type VARCHAR(50) NOT NULL, -- 'recent_activity', 'preference', 'pattern'
    title VARCHAR(255),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,

    -- 重要性（0.0 - 1.0，影响是否转入长期记忆）
    importance DECIMAL(3,2) DEFAULT 0.5,
    access_count INTEGER DEFAULT 0,

    -- 向量嵌入
    embedding vector(1536),

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- 索引
    INDEX idx_short_term_memory_user_id (user_id),
    INDEX idx_short_term_memory_importance (importance DESC),
    INDEX idx_short_term_memory_created_at (created_at DESC),
    INDEX idx_short_term_memory_embedding USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100)
);

-- 长期记忆（持久化，核心知识）
CREATE TABLE long_term_memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 记忆内容
    memory_type VARCHAR(50) NOT NULL, -- 'fact', 'preference', 'relationship', 'expertise'
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,

    -- 重要性（0.0 - 1.0）
    importance DECIMAL(3,2) DEFAULT 0.8,

    -- 访问统计
    access_count INTEGER DEFAULT 0,
    last_accessed_at TIMESTAMP WITH TIME ZONE,

    -- 向量嵌入（语义搜索）
    embedding vector(1536),

    -- 关联
    related_memories UUID[] DEFAULT ARRAY[]::UUID[],

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- 索引
    INDEX idx_long_term_memory_user_id (user_id),
    INDEX idx_long_term_memory_type (memory_type),
    INDEX idx_long_term_memory_importance (importance DESC),
    INDEX idx_long_term_memory_embedding USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100),
    INDEX idx_long_term_memory_content ON long_term_memory USING gin(to_tsvector('english', content))
);

-- ============================================================================
-- 同步记录表
-- ============================================================================
CREATE TABLE sync_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,

    -- 同步信息
    sync_type VARCHAR(20) NOT NULL, -- 'upload', 'download', 'bidirectional'
    events_count INTEGER DEFAULT 0,
    status VARCHAR(20) NOT NULL, -- 'pending', 'success', 'failed'

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

-- ============================================================================
-- AI分析任务队列表
-- ============================================================================
CREATE TABLE analysis_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 任务信息
    task_type VARCHAR(50) NOT NULL, -- 'portrait_analysis', 'pattern_extraction', 'insight_generation'
    priority INTEGER DEFAULT 5, -- 1-10, 10最高

    -- 输入数据
    input_data JSONB NOT NULL,

    -- 任务状态
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'

    -- 输出结果
    result JSONB,
    error_message TEXT,

    -- 重试机制
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,

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

-- ============================================================================
-- 初始数据
-- ============================================================================

-- 创建默认管理员用户（密码需要hashed，这里仅示例）
-- 实际部署时应该使用 bcrypt 或 argon2 生成密码哈希
-- INSERT INTO users (username, email, password_hash, is_verified)
-- VALUES ('admin', 'admin@lifespan.local', '$2b$10$...', true);

-- ============================================================================
-- 注释
-- ============================================================================

COMMENT ON TABLE users IS '用户表';
COMMENT ON TABLE devices IS '设备表';
COMMENT ON TABLE events IS '事件表（按月分区）';
COMMENT ON TABLE timelines IS '时间线表';
COMMENT ON TABLE user_portraits IS '用户画像表';
COMMENT ON TABLE working_memory IS 'AI工作记忆（短期）';
COMMENT ON TABLE short_term_memory IS 'AI短期记忆';
COMMENT ON TABLE long_term_memory IS 'AI长期记忆';
COMMENT ON TABLE sync_records IS '同步记录表';
COMMENT ON TABLE analysis_tasks IS 'AI分析任务队列表';
COMMENT ON TABLE user_preferences IS '用户偏好设置表';
COMMENT ON TABLE audit_logs IS '审计日志表';

COMMENT ON COLUMN events.encrypted_data IS '加密的事件详情（端到端加密）';
COMMENT ON COLUMN events.processed IS '是否已被AI分析处理';
COMMENT ON COLUMN user_portraits.embedding IS '用户画像向量嵌入，用于语义搜索';
COMMENT ON COLUMN long_term_memory.embedding IS '长期记忆向量嵌入，用于语义检索';
