# PostgreSQL 索引优化指南 - Lifespan 项目

## 目录
1. [索引策略总览](#索引策略总览)
2. [索引维护脚本](#索引维护脚本)
3. [查询性能优化](#查询性能优化)
4. [监控与分析](#监控与分析)
5. [常见问题](#常见问题)

---

## 索引策略总览

### 索引分类

| 索引类型 | 用途 | 示例 |
|---------|------|------|
| B-tree | 默认索引，支持范围查询 | user_id, timestamp |
| GIN | JSONB数组、全文搜索 | metadata, content |
| GiST | 地理数据、范围查询 | - |
| IVFFlat | 向量相似度搜索 | embedding |
| HNSW | 高性能向量搜索 | embedding (替代方案) |
| Partial | 条件索引，节省空间 | processed = false |

### 索引优先级

#### P0 - 必须索引（性能关键）
```sql
-- events表核心索引
CREATE INDEX idx_events_user_timestamp ON events(user_id, timestamp DESC);
CREATE INDEX idx_events_user_type_timestamp ON events(user_id, event_type, timestamp DESC);
CREATE INDEX idx_events_processed ON events(processed) WHERE processed = false;

-- timelines表
CREATE INDEX idx_timelines_date ON timelines(user_id, date DESC);

-- user_portraits向量索引
CREATE INDEX idx_user_portraits_embedding
ON user_portraits
USING ivfflat(embedding vector_cosine_ops)
WITH (lists = 100);
```

#### P1 - 重要索引（常用查询）
```sql
-- 单列查询索引
CREATE INDEX idx_events_event_type ON events(event_type);
CREATE INDEX idx_events_category ON events(category);
CREATE INDEX idx_devices_user_active ON devices(user_id, is_active);
CREATE INDEX idx_short_term_memory_importance ON short_term_memory(importance DESC);
```

#### P2 - 可选索引（特定场景）
```sql
-- JSONB字段索引（如需频繁查询）
CREATE INDEX idx_events_metadata ON events USING gin(metadata);
CREATE INDEX idx_timelines_category_stats ON timelines USING gin(category_stats);

-- 全文搜索索引
CREATE INDEX idx_long_term_memory_content
ON long_term_memory
USING gin(to_tsvector('english', content));
```

---

## 索引维护脚本

### 1. 索引使用分析

```sql
-- 查找未使用的索引
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan AS index_scans,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexrelname NOT LIKE 'pg_toast%'
ORDER BY pg_relation_size(indexrelid) DESC;

-- 查找低效索引（扫描多但返回少）
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan AS scans,
    idx_tup_read AS tuples_read,
    idx_tup_fetch AS tuples_fetched,
    idx_tup_read::float / NULLIF(idx_tup_fetch, 0) AS read_fetch_ratio
FROM pg_stat_user_indexes
WHERE idx_scan > 0
  AND idx_tup_read > 1000
ORDER BY read_fetch_ratio DESC;
```

### 2. 索引大小监控

```sql
-- 按表统计索引大小
SELECT
    t.tablename,
    pg_size_pretty(pg_relation_size(t.tablename::regclass)) AS table_size,
    pg_size_pretty(pg_indexes_size(t.tablename::regclass)) AS indexes_size,
    pg_indexes_size(t.tablename::regclass)::float /
    NULLIF(pg_relation_size(t.tablename::regclass), 0) AS index_ratio
FROM pg_tables t
WHERE t.schemaname = 'public'
ORDER BY pg_indexes_size(t.tablename::regclass) DESC;

-- 检查索引膨胀
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    pg_stat_get_dead_tuples(c.oid) AS dead_tuples
FROM pg_stat_user_indexes i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE pg_stat_get_dead_tuples(c.oid) > 1000
ORDER BY dead_tuples DESC;
```

### 3. 索引重建

```sql
-- 重建单个索引（不锁表）
REINDEX INDEX CONCURRENTLY idx_events_user_timestamp;

-- 重建表的所有索引（不锁表）
REINDEX TABLE CONCURRENTLY events;

-- 批量重建所有索引（谨慎使用）
DO $$
DECLARE
    idx RECORD;
BEGIN
    FOR idx IN
        SELECT indexrelid::regclass AS index_name
        FROM pg_stat_user_indexes
        WHERE schemaname = 'public'
    LOOP
        RAISE NOTICE 'Rebuilding index: %', idx.index_name;
        EXECUTE format('REINDEX INDEX CONCURRENTLY %I', idx.index_name);
    END LOOP;
END$$;
```

### 4. 自动分区创建

```sql
-- 自动创建未来3个月的分区
CREATE OR REPLACE FUNCTION maintain_partitions()
RETURNS void AS $$
DECLARE
    start_date date;
    i int;
BEGIN
    FOR i IN 0..3 LOOP
        start_date := date_trunc('month', CURRENT_DATE + (i || ' months')::interval);
        PERFORM create_monthly_partition('events', start_date);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 每月1号自动执行
SELECT cron.schedule('maintain-event-partitions', '0 0 1 * *',
    'SELECT maintain_partitions();');
```

### 5. 定期VACUUM和ANALYZE

```sql
-- 启用自动vacuum（postgresql.conf）
autovacuum = on
autovacuum_max_workers = 3
autovacuum_naptime = 1min

-- 针对events表配置
ALTER TABLE events SET (
    autovacuum_vacuum_scale_factor = 0.1,
    autovacuum_analyze_scale_factor = 0.05
);

-- 手动vacuum和analyze
VACUUM ANALYZE events;
VACUUM ANALYZE timelines;
VACUUM ANALYZE user_portraits;
```

---

## 查询性能优化

### 1. 使用EXPLAIN ANALYZE

```sql
-- 基础分析
EXPLAIN ANALYZE
SELECT * FROM events
WHERE user_id = 'xxx'
  AND timestamp >= '2026-02-01'
ORDER BY timestamp DESC
LIMIT 100;

-- 详细分析（包含缓冲区）
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM events
WHERE user_id = 'xxx'
  AND category = 'work';

-- 检查是否使用索引
-- 期望看到 "Index Scan" 或 "Index Only Scan"
-- 警告 "Seq Scan"（全表扫描）
```

### 2. 优化常见查询

#### 查询1: 用户今日事件

**慢查询**:
```sql
-- 全表扫描
SELECT * FROM events
WHERE user_id = $1
  AND date_trunc('day', timestamp) = CURRENT_DATE;
```

**优化后**:
```sql
-- 索引扫描
CREATE INDEX idx_events_user_timestamp ON events(user_id, timestamp DESC);

SELECT * FROM events
WHERE user_id = $1
  AND timestamp >= CURRENT_DATE
  AND timestamp < CURRENT_DATE + INTERVAL '1 day';
```

#### 查询2: 应用使用时长统计

**慢查询**:
```sql
-- 每行都调用date_trunc
SELECT
    date_trunc('day', timestamp) AS day,
    SUM(duration) AS total
FROM events
WHERE user_id = $1
GROUP BY day;
```

**优化后**:
```sql
-- 使用物化视图
CREATE MATERIALIZED VIEW user_daily_app_usage AS
SELECT
    user_id,
    date_trunc('day', timestamp) AS day,
    app_name,
    SUM(duration) AS total_duration,
    COUNT(*) AS event_count
FROM events
GROUP BY user_id, date_trunc('day', timestamp), app_name;

CREATE UNIQUE INDEX idx_daily_app_usage ON user_daily_app_usage(user_id, day, app_name);

-- 每小时刷新
SELECT cron.schedule('refresh-daily-app-usage', '0 * * * *',
    'REFRESH MATERIALIZED VIEW CONCURRENTLY user_daily_app_usage');
```

#### 查询3: 向量相似度搜索

**优化索引**:
```sql
-- 根据数据量调整lists参数
-- 10万行: lists = 316 (sqrt(100000))
-- 100万行: lists = 1000
CREATE INDEX idx_long_term_memory_embedding
ON long_term_memory
USING ivfflat(embedding vector_cosine_ops)
WITH (lists = 100);

-- 查询时设置 probes
SET ivfflat.probes = 10; -- 增加召回率

SELECT
    id,
    content,
    embedding <=> $1 AS distance
FROM long_term_memory
WHERE user_id = $2
ORDER BY embedding <=> $1
LIMIT 20;
```

### 3. 使用覆盖索引

```sql
-- 创建覆盖索引（包含查询所需的所有字段）
CREATE INDEX idx_events_covering
ON events(user_id, timestamp DESC)
INCLUDE (event_type, duration, category, app_name);

-- 查询时无需访问表（Index Only Scan）
EXPLAIN ANALYZE
SELECT
    timestamp,
    event_type,
    duration,
    category,
    app_name
FROM events
WHERE user_id = $1
  AND timestamp >= $2
ORDER BY timestamp DESC
LIMIT 100;
-- 期望看到 "Index Only Scan"
```

### 4. 批量操作优化

```sql
-- 批量插入（使用UNION ALL）
INSERT INTO events (user_id, device_id, event_type, timestamp, duration, ...)
SELECT $1, $2, $3, $4, $5, ...
UNION ALL
SELECT $1, $2, $3, $4, $5, ...
UNION ALL
...

-- 或使用COPY命令（更快）
COPY events (user_id, device_id, event_type, timestamp, duration, encrypted_data, iv)
FROM STDIN WITH (FORMAT csv);
```

---

## 监控与分析

### 1. 慢查询监控

```sql
-- 启用pg_stat_statements
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 查询最慢的查询
SELECT
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    max_exec_time,
    stddev_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;

-- 查询最频繁的查询
SELECT
    query,
    calls,
    total_exec_time / calls AS avg_time
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;
```

### 2. 表访问统计

```sql
-- 查看表的访问情况
SELECT
    schemaname,
    tablename,
    seq_scan,  -- 顺序扫描次数（应该尽量少）
    seq_tup_read,
    idx_scan,  -- 索引扫描次数
    idx_tup_fetch,
    n_tup_ins,
    n_tup_upd,
    n_tup_del,
    n_tup_hot_upd
FROM pg_stat_user_tables
ORDER BY seq_scan DESC;
```

### 3. 连接和锁监控

```sql
-- 当前活跃连接
SELECT
    pid,
    usename,
    application_name,
    client_addr,
    state,
    query_start,
    state_change,
    query
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY query_start;

-- 等待锁的查询
SELECT
    pid,
    usename,
    pg_blocking_pids(pid) AS blocked_by,
    query
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0;
```

### 4. 缓存命中率

```sql
-- 缓存命中率（应该>99%）
SELECT
    sum(heap_blks_read) AS heap_read,
    sum(heap_blks_hit) AS heap_hit,
    sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0) AS cache_hit_ratio
FROM pg_statio_user_tables;

-- 索引缓存命中率
SELECT
    sum(idx_blks_read) AS idx_read,
    sum(idx_blks_hit) AS idx_hit,
    sum(idx_blks_hit) / NULLIF(sum(idx_blks_hit) + sum(idx_blks_read), 0) AS idx_cache_hit_ratio
FROM pg_statio_user_indexes;
```

---

## 常见问题

### Q1: 索引应该建多少？

**A**: 不是越多越好，权衡点：
- **写入性能**: 每个索引都会降低插入速度
- **存储空间**: 每个索引占用额外空间
- **维护成本**: 需要定期vacuum和reindex

**建议**:
- 单表索引不超过5-7个
- 优先创建复合索引而非多个单列索引
- 定期删除未使用的索引

### Q2: 为什么查询不走索引？

**原因**:
1. **数据量太小**: 优化器认为全表扫描更快
2. **选择性差**: 索引列值重复率高（如性别）
3. **函数包装**: `WHERE date_trunc('day', timestamp) = ...`
4. **类型不匹配**: `WHERE user_id = 123` (user_id是UUID)
5. **统计信息过期**: 需要ANALYZE

**解决方案**:
```sql
-- 1. 重写查询（避免函数）
-- 坏: WHERE date_trunc('day', timestamp) = '2026-02-26'
-- 好: WHERE timestamp >= '2026-02-26' AND timestamp < '2026-02-27'

-- 2. 类型匹配
-- 坏: WHERE user_id = 123
-- 好: WHERE user_id = '123e4567-e89b-12d3-a456-426614174000'

-- 3. 更新统计信息
ANALYZE events;

-- 4. 强制使用索引（不推荐）
SET enable_seqscan = off;
```

### Q3: 何时使用部分索引？

**A**: 满足以下条件时：
1. 查询总是带WHERE条件
2. 符合条件的行很少

**示例**:
```sql
-- 只索引未处理的事件
CREATE INDEX idx_events_unprocessed
ON events(user_id, timestamp DESC)
WHERE processed = false;

-- 索引大小减少90%，查询更快
```

### Q4: 向量索引如何选择？

**对比**:

| 索引类型 | 构建速度 | 查询速度 | 更新速度 | 内存占用 |
|---------|---------|---------|---------|----------|
| IVFFlat | 快 | 中 | 快 | 低 |
| HNSW | 慢 | 快 | 慢 | 高 |

**建议**:
- 数据量<10万: IVFFlat (lists = 100)
- 数据量10-100万: IVFFlat (lists = 316-1000)
- 数据量>100万: HNSW (m = 16, ef_construction = 64)

### Q5: 如何优化复合索引列顺序？

**原则**:
1. **等值条件列放前面**
   ```sql
   WHERE user_id = $1 AND timestamp >= $2
   -- 索引: (user_id, timestamp)
   ```

2. **范围查询列放后面**
   ```sql
   WHERE user_id = $1 AND timestamp >= $2 AND timestamp < $3
   -- 索引: (user_id, timestamp)
   ```

3. **排序字段放最后**
   ```sql
   WHERE user_id = $1
   ORDER BY timestamp DESC
   -- 索引: (user_id, timestamp DESC)
   ```

### Q6: 分区表索引怎么建？

**A**: 只在主表建索引，分区自动继承
```sql
-- 只需在主表执行一次
CREATE INDEX idx_events_user_timestamp ON events(user_id, timestamp DESC);

-- 所有分区自动拥有该索引
-- events_2026_02, events_2026_03, ...
```

---

## 索引优化检查清单

### 新建表时
- [ ] 为外键创建索引
- [ ] 为常用查询条件创建索引
- [ ] 考虑使用复合索引
- [ ] 评估是否需要部分索引
- [ ] 设置合理的FILLFACTOR

### 上线前
- [ ] EXPLAIN ANALYZE所有核心查询
- [ ] 确保没有全表扫描（除小表）
- [ ] 检查索引大小（不超过表大小30%）
- [ ] 配置autovacuum参数
- [ ] 设置慢查询日志

### 运维中
- [ ] 每周检查未使用索引
- [ ] 每月检查索引膨胀
- [ ] 每月ANALYZE更新统计
- [ ] 每季度REINDEX重建索引
- [ ] 监控慢查询日志

---

## 总结

本索引优化指南针对Lifespan项目的特点：
- **高写入**: 优化events表索引，减少写入开销
- **时间查询**: 优化timestamp索引，支持时间范围查询
- **向量搜索**: 选择合适的向量索引类型
- **分区表**: 利用分区裁剪提升性能
- **持续优化**: 建立监控和维护流程

**预期效果**:
- 查询P95延迟: < 100ms
- 索引命中率: > 99%
- 缓存命中率: > 95%
- 插入性能: > 10000 events/s
