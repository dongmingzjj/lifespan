# Lifespan 数据库架构设计文档

## 目录
1. [概述](#概述)
2. [PostgreSQL表结构](#postgresql表结构)
3. [索引优化](#索引优化)
4. [数据分区](#数据分区)
5. [向量搜索](#向量搜索)
6. [数据流转](#数据流转)
7. [性能优化](#性能优化)
8. [扩展性](#扩展性)

---

## 概述

### 设计原则
1. **隐私优先**: 敏感数据端到端加密
2. **本地优先**: 减少服务器压力
3. **高性能**: 支持海量事件查询
4. **可扩展**: 支持多端同步和AI分析
5. **可维护**: 清晰的表结构和索引策略

### 技术栈
- **PostgreSQL 16+**: 主数据库
- **pgvector**: 向量嵌入和语义搜索
- **Redis**: 缓存和队列

---

## PostgreSQL表结构

### 核心表概览

| 表名 | 说明 | 数据量级 | 访问频率 |
|------|------|----------|----------|
| users | 用户信息 | 小 | 高 |
| devices | 设备管理 | 中 | 中 |
| events | 事件数据（分区） | 大（百万/天） | 高 |
| timelines | 时间线 | 中 | 高 |
| user_portraits | 用户画像 | 小 | 中 |
| working_memory | AI工作记忆 | 小 | 高 |
| short_term_memory | AI短期记忆 | 中 | 高 |
| long_term_memory | AI长期记忆 | 小-中 | 中 |
| sync_records | 同步记录 | 中 | 中 |
| analysis_tasks | AI任务队列 | 中 | 高 |
| user_preferences | 用户偏好 | 小 | 中 |
| audit_logs | 审计日志 | 大 | 低 |

---

### 1. users (用户表)

**设计要点**:
- 使用UUID作为主键（分布式友好）
- 存储公钥用于端到端加密
- JSONB metadata字段支持灵活扩展

**查询模式**:
```sql
-- 按email查询（登录）
SELECT * FROM users WHERE email = $1;

-- 查询用户概览
SELECT * FROM user_overview WHERE id = $1;
```

---

### 2. devices (设备表)

**设计要点**:
- 每个用户可有多个设备
- device_id为设备唯一标识（硬件ID）
- 记录最后活跃时间

**查询模式**:
```sql
-- 查询用户所有活跃设备
SELECT * FROM devices
WHERE user_id = $1 AND is_active = true;

-- 更新心跳
UPDATE devices
SET last_seen_at = CURRENT_TIMESTAMP
WHERE device_id = $2;
```

---

### 3. events (事件表) - 核心表

**设计要点**:
- **按月分区**: 查询性能 + 易于归档
- **加密存储**: encrypted_data + iv + auth_tag
- **明文索引字段**: app_name, category, domain（加速查询）
- **processed标记**: 未处理事件进入AI队列
- **JSONB metadata**: 灵活存储不同类型事件的额外信息

**数据结构**:
```
事件类型:
1. app_usage: 应用使用
2. web_activity: 网页浏览
3. file_activity: 文件操作
4. communication: 通信记录

加密字段:
- encrypted_data: 完整事件详情（加密）
- iv: 初始化向量
- auth_tag: 认证标签

可搜索明文字段:
- app_name: 应用名称
- category: 分类
- domain: 域名
```

**查询模式**:
```sql
-- 查询用户今日事件
SELECT * FROM events
WHERE user_id = $1
  AND timestamp >= CURRENT_DATE
ORDER BY timestamp DESC;

-- 查询特定应用使用时长
SELECT
    date_trunc('day', timestamp) AS day,
    SUM(duration) AS total_duration
FROM events
WHERE user_id = $1
  AND app_name = $2
  AND timestamp >= $3
GROUP BY day
ORDER BY day;

-- 查询未处理事件（AI分析）
SELECT * FROM events
WHERE processed = false
LIMIT 1000;

-- 按分类统计
SELECT
    category,
    COUNT(*) AS event_count,
    SUM(duration) AS total_duration
FROM events
WHERE user_id = $1
  AND timestamp >= CURRENT_DATE
GROUP BY category;
```

---

### 4. timelines (时间线表)

**设计要点**:
- 每日一条记录（unique constraint）
- 预聚合统计（减少实时计算）
- JSONB存储详细片段和统计

**查询模式**:
```sql
-- 查询最近7天时间线
SELECT * FROM timelines
WHERE user_id = $1
  AND date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY date DESC;

-- 查询生产力趋势
SELECT
    date,
    productivity_score,
    total_work_hours
FROM timelines
WHERE user_id = $1
  AND date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date;
```

---

### 5. user_portraits (用户画像表)

**设计要点**:
- 版本控制（version, previous_version_id）
- 向量嵌入（embedding）用于语义搜索
- JSONB存储完整画像结构
- confidence_score表示置信度

**向量搜索示例**:
```sql
-- 查找相似用户画像
SELECT
    user_id,
    profile,
    patterns,
    1 - (embedding <=> $1) AS similarity
FROM user_portraits
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1
LIMIT 10;

-- 查询用户最新画像
SELECT * FROM latest_user_portraits
WHERE user_id = $1;
```

---

### 6. 记忆系统表（三层架构）

#### working_memory (工作记忆)
- **用途**: 当前会话上下文
- **TTL**: 1小时（自动过期）
- **容量**: 限制100条/用户

#### short_term_memory (短期记忆)
- **用途**: 最近活动和偏好
- **保留期**: 7-30天
- **重要性**: 影响是否转入长期记忆

#### long_term_memory (长期记忆)
- **用途**: 持久化知识
- **向量嵌入**: 语义搜索
- **关联**: related_memories数组

**查询示例**:
```sql
-- 语义搜索长期记忆
SELECT
    id,
    memory_type,
    title,
    content,
    1 - (embedding <=> $1) AS similarity
FROM long_term_memory
WHERE user_id = $2
  AND embedding IS NOT NULL
ORDER BY embedding <=> $1
LIMIT 20;

-- 查询高重要性记忆
SELECT * FROM long_term_memory
WHERE user_id = $1
  AND importance >= 0.8
ORDER BY last_accessed_at DESC NULLS LAST;
```

---

## 索引优化

### 索引设计原则
1. **选择性高**: 优先为高选择性的列创建索引
2. **覆盖索引**: 包含常用查询字段
3. **复合索引**: 多列组合索引（注意列顺序）
4. **部分索引**: 仅索引常用子集
5. **表达式索引**: 支持函数查询

### 核心索引

#### events表索引
```sql
-- 单列索引
CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX idx_events_event_type ON events(event_type);

-- 复合索引（最重要）
CREATE INDEX idx_events_user_timestamp ON events(user_id, timestamp DESC);
CREATE INDEX idx_events_user_type_timestamp ON events(user_id, event_type, timestamp DESC);
CREATE INDEX idx_events_user_category_timestamp ON events(user_id, category, timestamp DESC);

-- 部分索引（仅未处理事件）
CREATE INDEX idx_events_processed ON events(processed)
WHERE processed = false;

-- GIN索引（JSONB字段）
CREATE INDEX idx_events_metadata ON events USING gin(metadata);
```

**查询性能对比**:
```
无索引: 全表扫描 (1000万行 ~ 10秒)
单列索引: 索引扫描 + 堆取 (100万行 ~ 500ms)
复合索引: 索引只扫描 (1万行 ~ 20ms)
```

#### user_portraits表索引
```sql
-- 向量索引（IVFFlat）
CREATE INDEX idx_user_portraits_embedding
ON user_portraits
USING ivfflat(embedding vector_cosine_ops)
WITH (lists = 100);

-- GIN索引（JSONB字段）
CREATE INDEX idx_user_portraits_profile
ON user_portraits USING gin(profile);
```

#### timelines表索引
```sql
-- 复合唯一索引
CREATE INDEX idx_timelines_date ON timelines(user_id, date DESC);

-- 部分索引（高生产力天数）
CREATE INDEX idx_timelines_productivity
ON timelines(user_id, productivity_score DESC)
WHERE productivity_score >= 0.8;
```

### 索引维护
```sql
-- 分析索引使用情况
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan AS index_scans,
    idx_tup_read AS tuples_read,
    idx_tup_fetch AS tuples_fetched
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;

-- 重建索引（维护）
REINDEX INDEX CONCURRENTLY idx_events_user_timestamp;

-- 检查索引膨胀
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;
```

---

## 数据分区

### 分区策略

#### events表按月分区
**原因**:
1. 事件数据量大（预计每天百万级）
2. 查询通常基于时间范围
3. 易于归档和清理旧数据

**分区管理**:
```sql
-- 创建新分区（每月初执行）
SELECT create_monthly_partition('events', date_trunc('month', CURRENT_DATE + interval '3 months'));

-- 归档旧分区（超过3年）
-- 1. 分离旧分区
ALTER TABLE events DETACH PARTITION events_2023_01;

-- 2. 移动到归档表
ALTER TABLE events_2023_01 RENAME TO events_archive_2023_01;

-- 3. 可选：导出到对象存储
pg_dump -t events_archive_2023_01 | gzip > archive_2023_01.sql.gz
```

**分区查询优化**:
```sql
-- 分区裁剪（只扫描相关分区）
EXPLAIN ANALYZE
SELECT * FROM events
WHERE user_id = $1
  AND timestamp >= '2026-02-01'::date
  AND timestamp < '2026-03-01'::date;
-- 结果：只扫描 events_2026_02 分区
```

### 归档策略
```
保留策略:
- 热数据: 最近3个月（PostgreSQL主库）
- 温数据: 3-12个月（PostgreSQL归档库）
- 冷数据: 12个月以上（对象存储或删除）

清理任务:
- 每月初自动归档36个月前的数据
- 保留聚合统计（在timelines表）
```

---

## 向量搜索

### pgvector使用

#### 向量嵌入生成
```typescript
// 使用智谱AI或OpenAI生成嵌入
const embedding = await generateEmbedding(text);
// 1536维向量（OpenAI格式）
```

#### 语义搜索示例

**用户画像相似度搜索**:
```sql
-- 查找行为模式相似的用户
SELECT
    u.id,
    u.username,
    p.profile,
    1 - (p.embedding <=> $1) AS similarity
FROM user_portraits p
JOIN users u ON u.id = p.user_id
WHERE p.embedding IS NOT NULL
  AND p.user_id != $2  -- 排除自己
ORDER BY p.embedding <=> $1
LIMIT 10;
```

**记忆检索**:
```sql
-- 根据查询语义搜索长期记忆
SELECT
    id,
    memory_type,
    title,
    content,
    importance,
    1 - (embedding <=> $1) AS similarity
FROM long_term_memory
WHERE user_id = $2
  AND embedding IS NOT NULL
ORDER BY
    embedding <=> $1,
    importance DESC
LIMIT 20;
```

### 向量索引调优

#### IVFFlat参数选择
```sql
-- lists参数 = sqrt(行数)
-- 100万行 -> lists = 1000
-- 10万行 -> lists = 316
CREATE INDEX idx_long_term_memory_embedding
ON long_term_memory
USING ivfflat(embedding vector_cosine_ops)
WITH (lists = 100);
```

#### HNSW索引（更高性能）
```sql
-- 更快的查询速度，更大的存储
CREATE INDEX idx_events_embedding_hnsw
ON events
USING hnsw(embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

---

## 数据流转

### 事件数据流程

```
1. 采集端（Windows/Android）
   ↓ 本地SQLite存储
2. 加密同步
   ↓ HTTPS传输
3. 服务器接收
   ↓ 解密验证
4. 写入PostgreSQL (events表)
   ↓ 触发AI分析
5. 生成时间线 (timelines表)
   ↓ 更新用户画像
6. 缓存到Redis
   ↓ 推送到前端
```

### AI分析流程

```
1. 事件累积
   ↓ (6小时或1000条)
2. 创建分析任务 (analysis_tasks表)
   ↓ 后台worker处理
3. 调用智谱AI API
   ↓ 生成画像/洞察
4. 更新用户画像 (user_portraits表)
   ↓ 提取记忆
5. 存入记忆系统
   ↓ 更新缓存
6. 通知用户
```

---

## 性能优化

### 查询优化

#### 使用CTE优化复杂查询
```sql
WITH daily_stats AS (
    SELECT
        date_trunc('day', timestamp) AS day,
        category,
        SUM(duration) AS total_duration
    FROM events
    WHERE user_id = $1
      AND timestamp >= $2
    GROUP BY day, category
)
SELECT
    day,
    json_object_agg(category, total_duration) AS categories
FROM daily_stats
GROUP BY day
ORDER BY day;
```

#### 物化视图（预聚合）
```sql
CREATE MATERIALIZED VIEW user_daily_stats AS
SELECT
    user_id,
    date_trunc('day', timestamp) AS day,
    COUNT(*) AS event_count,
    SUM(duration) AS total_duration,
    json_object_agg(category, SUM(duration)) AS by_category
FROM events
GROUP BY user_id, date_trunc('day', timestamp);

-- 定时刷新（每小时）
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('refresh-daily-stats', '0 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY user_daily_stats');
```

### 连接池配置

```javascript
// 使用PgBouncer或连接池
const pool = new Pool({
  host: 'localhost',
  database: 'lifespan',
  max: 20, // 最大连接数
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// N100限制：4G内存建议max=20-50
```

### 批量操作

```sql
-- 批量插入事件（使用COPY）
COPY events (user_id, device_id, event_type, timestamp, duration, encrypted_data, iv)
FROM '/tmp/events.csv'
WITH (FORMAT csv);

-- 或使用INSERT ... ON CONFLICT
INSERT INTO events (...)
VALUES (...), (...), (...)
ON CONFLICT DO NOTHING;
```

---

## 扩展性

### 水平扩展

#### 读写分离
```
主库: 处理写操作
从库: 处理读操作（查询、报表）
同步: 逻辑复制或物理复制
```

#### 分片策略（未来）
```
按user_id分片:
- Shard 1: user_id % 4 = 0
- Shard 2: user_id % 4 = 1
- Shard 3: user_id % 4 = 2
- Shard 4: user_id % 4 = 3

优点:
- 均衡负载
- 易于扩展
- 查询路由简单
```

### 垂直扩展

#### N100服务器配置
```ini
# postgresql.conf
shared_buffers = 1GB          # 25% of RAM
effective_cache_size = 3GB    # 75% of RAM
maintenance_work_mem = 256MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1        # SSD
effective_io_concurrency = 200
max_worker_processes = 4
max_parallel_workers_per_gather = 2
max_parallel_workers = 4
```

### 监控指标

```sql
-- 查询慢查询
SELECT
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    max_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- 表大小监控
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- 连接数监控
SELECT
    count(*) AS connections,
    state
FROM pg_stat_activity
GROUP BY state;
```

---

## 数据迁移

### 初始部署
```bash
# 1. 创建数据库
createdb lifespan

# 2. 执行schema
psql -d lifespan -f 001_initial_schema.sql

# 3. 创建用户
psql -d lifespan -c "CREATE ROLE lifes_user WITH LOGIN PASSWORD 'xxx';"
psql -d lifespan -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO lifes_user;"
```

### 版本升级
```sql
-- 使用迁移工具（如node-pg-migrate，Flyway）
-- 示例：添加新字段
ALTER TABLE events ADD COLUMN browser_version VARCHAR(50);
CREATE INDEX idx_events_browser ON events(browser_version);
```

---

## 备份与恢复

### 备份策略
```bash
# 每日全量备份
pg_dump -Fc lifespan > lifespan_$(date +%Y%m%d).dump

# 每小时WAL归档（持续备份）
# postgresql.conf:
wal_level = replica
archive_mode = on
archive_command = 'cp %p /backup/wal/%f'
```

### 恢复流程
```bash
# 1. 恢复全量备份
pg_restore -d lifespan_new lifespan_20260226.dump

# 2. 应用WAL日志（PITR）
# 恢复到指定时间点
```

---

## 总结

本数据库架构设计针对Lifespan项目的特点：
1. **高吞吐**: 支持百万级事件/天
2. **隐私保护**: 端到端加密 + 敏感数据脱敏
3. **智能分析**: 向量搜索支持AI功能
4. **可扩展**: 分区 + 物化视图 + 缓存
5. **可维护**: 清晰的表结构 + 完善的索引

**预估容量（单用户）**:
- 事件数据: 1MB/天
- 时间线: 10KB/天
- 用户画像: 50KB
- 记忆: 100KB/月

**N100服务器容量**:
- 支持用户数: 100-500活跃用户
- 数据保留: 3年在线 + 归档
- 查询性能: P95 < 100ms
