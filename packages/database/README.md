# Lifespan Database Package

数据库架构和Schema定义包

## 概述

本包提供Lifespan项目的完整数据库架构，包括：
- PostgreSQL表结构（分区表、向量索引）
- Redis缓存策略
- 索引优化方案
- 数据维护脚本

## 目录结构

```
packages/database/
├── schema/
│   └── 001_initial_schema.sql       # PostgreSQL DDL（原始设计）
├── migrations/
│   ├── 001_initial_schema.up.sql    # 迁移脚本（创建）
│   └── 001_initial_schema.down.sql  # 迁移脚本（回滚）
├── docs/
│   ├── postgresql-schema.md         # Schema详细文档
│   └── index-optimization-guide.md  # 索引优化指南
├── redis-cache-strategy.md          # Redis缓存策略
└── README.md                         # 本文件
```

## 快速开始

### 1. 初始化数据库

#### 方法A：使用迁移文件（推荐）

```bash
# 创建数据库
createdb lifespan

# 执行迁移
psql -d lifespan -f migrations/001_initial_schema.up.sql

# 创建应用用户
psql -d lifespan -c "CREATE ROLE lifes_user WITH LOGIN PASSWORD 'your_password';"
psql -d lifespan -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO lifes_user;"
psql -d lifespan -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO lifes_user;"
```

#### 方法B：使用原始schema

```bash
# 创建数据库
createdb lifespan

# 执行schema
psql -d lifespan -f schema/001_initial_schema.sql

# 创建应用用户
psql -d lifespan -c "CREATE ROLE lifes_user WITH LOGIN PASSWORD 'your_password';"
psql -d lifespan -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO lifes_user;"
```

#### 回滚迁移

```bash
# 删除所有数据库对象
psql -d lifespan -f migrations/001_initial_schema.down.sql
```

### 2. 配置pgvector

确保PostgreSQL已安装pgvector扩展：

```bash
# Ubuntu/Debian
sudo apt-get install postgresql-16-pgvector

# macOS (Homebrew)
brew install pgvector

# 或从源码编译
git clone --branch v0.7.0 https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install
```

### 3. 配置Redis

```bash
# 安装Redis
sudo apt-get install redis-server  # Ubuntu
brew install redis                  # macOS

# 启动Redis
redis-server

# 测试连接
redis-cli ping
# 应该返回: PONG
```

## 核心表说明

### users (用户表)
- 存储用户基本信息和配置
- 支持端到端加密（公钥存储）
- 时区和语言设置

### devices (设备表)
- 多设备管理
- 设备类型：Windows、Android、iOS、macOS
- 在线状态追踪

### events (事件表) ⭐
- **按月分区**，支持海量数据存储
- **加密存储**敏感数据
- 支持多种事件类型：
  - app_usage (应用使用)
  - web_activity (网页浏览)
  - file_activity (文件操作)
  - communication (通信记录)

### timelines (时间线表)
- 每日时间线聚合
- 预计算统计数据
- AI生成的洞察

### user_portraits (用户画像表)
- 版本控制
- **向量嵌入**支持语义搜索
- 完整的用户行为画像

### 记忆系统 (三层架构)
- **working_memory**: 当前会话上下文
- **short_term_memory**: 短期记忆（7-30天）
- **long_term_memory**: 长期记忆（持久化）

## 索引策略

### B-tree索引
- 默认索引，支持范围查询
- 用于：user_id, timestamp, event_type等

### GIN索引
- JSONB字段搜索
- 用于：metadata, category_stats等

### IVFFlat/HNSW索引
- 向量相似度搜索
- 用于：embedding字段

### 部分索引
- 条件索引，节省空间
- 示例：`WHERE processed = false`

## 数据分区

### events表按月分区

```sql
-- 自动创建分区函数
SELECT create_monthly_partition('events', date_trunc('month', CURRENT_DATE));

-- 查询自动分区裁剪
SELECT * FROM events
WHERE timestamp >= '2026-02-01' AND timestamp < '2026-03-01';
-- 只扫描 events_2026_02 分区
```

### 归档策略
- 热数据: 最近3个月（在线）
- 温数据: 3-12个月（归档库）
- 冷数据: 12个月以上（删除或对象存储）

## 向量搜索

### 用户画像相似度

```sql
-- 查找行为模式相似的用户
SELECT
    u.username,
    1 - (p.embedding <=> $1) AS similarity
FROM user_portraits p
JOIN users u ON u.id = p.user_id
WHERE p.embedding IS NOT NULL
ORDER BY p.embedding <=> $1
LIMIT 10;
```

### 语义搜索记忆

```sql
-- 根据查询语义搜索长期记忆
SELECT
    title,
    content,
    1 - (embedding <=> $1) AS similarity
FROM long_term_memory
WHERE user_id = $2
ORDER BY embedding <=> $1
LIMIT 20;
```

## Redis缓存策略

### 缓存键命名规范
```
lifespan:user:{user_id}:profile
lifespan:user:{user_id}:portrait
lifespan:timeline:{user_id}:{date}
lifespan:events:{user_id}:latest
```

### 主要缓存
- **用户信息**: TTL 1小时
- **用户画像**: TTL 24小时
- **时间线**: TTL 7天
- **最新事件**: TTL 5分钟
- **AI分析结果**: TTL 24小时

详细策略见：[redis-cache-strategy.md](./redis-cache-strategy.md)

## 性能优化

### 查询优化

```sql
-- 使用EXPLAIN ANALYZE分析查询
EXPLAIN ANALYZE
SELECT * FROM events
WHERE user_id = $1 AND timestamp >= $2
ORDER BY timestamp DESC;

-- 期望看到: Index Scan 或 Index Only Scan
-- 警告: Seq Scan (全表扫描)
```

### 批量操作

```sql
-- 批量插入
INSERT INTO events (...) VALUES (...), (...), (...);

-- 或使用COPY（更快）
COPY events FROM STDIN WITH (FORMAT csv);
```

### 物化视图

```sql
-- 预聚合常用统计
CREATE MATERIALIZED VIEW user_daily_stats AS
SELECT
    user_id,
    date_trunc('day', timestamp) AS day,
    SUM(duration) AS total_duration
FROM events
GROUP BY user_id, day;

-- 定时刷新
REFRESH MATERIALIZED VIEW CONCURRENTLY user_daily_stats;
```

## 维护脚本

### 索引维护

```bash
# 查找未使用的索引
psql -d lifespan -c "
SELECT indexname, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
"

# 重建索引
psql -d lifespan -c "REINDEX INDEX CONCURRENTLY idx_events_user_timestamp;"

# 分析表
psql -d lifespan -c "VACUUM ANALYZE events;"
```

### 分区维护

```sql
-- 创建下月分区
SELECT create_monthly_partition('events', date_trunc('month', CURRENT_DATE + INTERVAL '1 month'));

-- 归档旧分区
ALTER TABLE events DETACH PARTITION events_2023_01;
ALTER TABLE events_2023_01 RENAME TO events_archive_2023_01;
```

## 监控

### 慢查询监控

```sql
-- 启用pg_stat_statements
CREATE EXTENSION pg_stat_statements;

-- 查询最慢的查询
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

### 表大小监控

```sql
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### 缓存命中率

```sql
SELECT
    sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0) AS cache_hit_ratio
FROM pg_statio_user_tables;
```

## 备份与恢复

### 备份

```bash
# 全量备份
pg_dump -Fc lifespan > lifespan_$(date +%Y%m%d).dump

# 仅schema
pg_dump -s lifespan > schema.sql

# 仅数据
pg_dump -a lifespan > data.sql
```

### 恢复

```bash
# 恢复全量备份
pg_restore -d lifespan_new lifespan_20260226.dump

# 执行schema
psql -d lifespan -f schema/001_initial_schema.sql
```

## 配置建议

### PostgreSQL配置 (N100: 4G/64G)

```ini
# postgresql.conf
shared_buffers = 1GB
effective_cache_size = 3GB
maintenance_work_mem = 256MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1  # SSD
effective_io_concurrency = 200
max_worker_processes = 4
max_parallel_workers_per_gather = 2

# 启用pgvector
shared_preload_libraries = 'vector'
```

### Redis配置

```ini
# redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
```

## 开发指南

### 添加新表

1. 在`schema/`目录创建迁移文件
2. 定义表结构
3. 创建必要的索引
4. 更新文档

### 添加新索引

1. 分析查询模式
2. 创建索引
3. 使用EXPLAIN ANALYZE验证
4. 更新文档

### 数据库迁移

#### 手动迁移（当前方法）

```bash
# 执行迁移
psql -d lifespan -f migrations/001_initial_schema.up.sql

# 回滚迁移
psql -d lifespan -f migrations/001_initial_schema.down.sql
```

#### 使用迁移工具（推荐用于生产）

```bash
# 安装 dbmate
go install github.com/amacneil/dbmate@latest

# 或安装 node-pg-migrate
npm install -g node-pg-migrate

# 创建迁移
node-pg-migrate create add_new_field

# 执行迁移
node-pg-migrate up
```

#### 迁移文件命名规范

```
migrations/
├── 001_initial_schema.up.sql
├── 001_initial_schema.down.sql
├── 002_add_user_settings.up.sql
├── 002_add_user_settings.down.sql
└── ...
```

## 故障排查

### 连接问题
```bash
# 检查PostgreSQL状态
sudo systemctl status postgresql

# 检查连接数
psql -c "SELECT count(*) FROM pg_stat_activity;"

# 查看最大连接数
psql -c "SHOW max_connections;"
```

### 性能问题
```bash
# 查看慢查询
psql -c "SELECT query, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"

# 查看锁等待
psql -c "SELECT * FROM pg_stat_activity WHERE wait_event_type = 'Lock';"
```

### 磁盘空间
```bash
# 查看数据库大小
psql -c "SELECT pg_size_pretty(pg_database_size('lifespan'));"

# 查看表大小
psql -c "SELECT tablename, pg_size_pretty(pg_total_relation_size(tablename::regclass)) FROM pg_tables ORDER BY pg_total_relation_size(tablename::regclass) DESC;"
```

## 参考资料

- [PostgreSQL Schema 文档](./docs/postgresql-schema.md) - 详细的表结构文档
- [PostgreSQL文档](https://www.postgresql.org/docs/)
- [pgvector文档](https://github.com/pgvector/pgvector)
- [Redis文档](https://redis.io/documentation)
- [项目技术架构](../../docs/01-technical-architecture.md)
- [SESSION-CONTEXT](../../SESSION-CONTEXT.md)

## 许可证

MIT
