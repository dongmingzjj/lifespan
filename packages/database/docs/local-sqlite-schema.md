# 本地 SQLite 数据库设计文档

**Windows Collector - Local Storage Schema**

版本: 1.0.0
更新: 2026-02-26

---

## 概述

Windows Collector 使用本地 SQLite 数据库作为主要存储，遵循**本地优先**架构原则。所有事件数据首先存储在本地加密的 SQLite 数据库中，然后异步同步到服务器。

### 设计原则

1. **本地优先**: 所有数据先存储在本地，确保离线可用
2. **隐私保护**: 敏感数据使用 AES-256-GCM 加密
3. **性能优化**: 为常用查询添加索引，支持高并发写入
4. **同步可靠**: 使用队列机制管理同步状态和失败重试
5. **数据完整**: 使用外键约束和触发器维护数据一致性

---

## 数据库架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     SQLite Local Database                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌───────────────┐     ┌───────────────┐     ┌──────────────┐  │
│  │    events     │────▶│  sync_queue   │     │ device_info  │  │
│  │  (核心事件)    │     │  (同步队列)    │     │  (设备信息)   │  │
│  └───────────────┘     └───────────────┘     └──────────────┘  │
│         │                      │                                  │
│         │                      │                                  │
│         ▼                      ▼                                  │
│  ┌───────────────┐     ┌───────────────┐                          │
│  │ sync_history  │     │   (触发器)     │                          │
│  │ (同步历史)     │     │  - 自动添加    │                          │
│  └───────────────┘     │    同步任务    │                          │
│                         │  - 更新状态    │                          │
│                         └───────────────┘                          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  │ [加密同步]
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PostgreSQL Server                            │
│                    (远程云服务器)                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 表结构详解

### 1. events 表 - 核心事件存储

存储所有用户活动事件，包括应用使用、网页浏览、文件操作等。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PRIMARY KEY | 自增主键 |
| `event_type` | TEXT | NOT NULL, CHECK | 事件类型：app_usage, web_activity, file_activity, communication |
| `timestamp` | INTEGER | NOT NULL | Unix timestamp (毫秒) |
| `duration` | INTEGER | NOT NULL, DEFAULT 0 | 持续时间（秒） |
| `encrypted_data` | BLOB | NOT NULL | AES-256-GCM 加密的事件详情 JSON |
| `nonce` | BLOB | NOT NULL | 加密 nonce (12 bytes) |
| `auth_tag` | BLOB | - | 认证标签 (16 bytes) |
| `app_name` | TEXT | - | 应用名称（明文，用于快速查询） |
| `category` | TEXT | - | 分类：work, communication, entertainment 等 |
| `synced` | INTEGER | NOT NULL, DEFAULT 0 | 同步状态：0=未同步, 1=已同步 |
| `synced_at` | INTEGER | - | 同步成功的时间戳 |
| `created_at` | INTEGER | NOT NULL | 创建时间 |

**加密数据结构** (`encrypted_data` 内的 JSON):
```json
{
  "id": "uuid",
  "type": "app_usage",
  "timestamp": 1740547200000,
  "deviceId": "device-uuid",
  "appName": "Visual Studio Code",
  "windowTitle": "lifespan - apps/desktop/src-tauri/src/main.rs",
  "duration": 3600,
  "category": "work",
  "metadata": {
    "executablePath": "C:\\Program Files\\...",
    "processId": 12345
  }
}
```

**查询性能预估**:
- 时间范围查询 (使用 `idx_events_timestamp`): **O(log n)**
- 未同步事件查询 (使用 `idx_events_synced`): **O(log n)**
- 按应用名统计 (使用 `idx_events_app_name`): **O(log n + k)**, k 为结果数量

---

### 2. device_info 表 - 设备信息

存储当前设备的元数据和同步状态。这是一个**单行表**（只有一条记录）。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PRIMARY KEY CHECK(id=1) | 强制单行 |
| `device_id` | TEXT | NOT NULL, UNIQUE | 本地设备 UUID |
| `device_name` | TEXT | NOT NULL | 设备名称（如 DESKTOP-ABC123） |
| `os_version` | TEXT | - | 操作系统版本 |
| `app_version` | TEXT | - | Collector 应用版本 |
| `user_id` | TEXT | - | 服务器分配的用户 ID |
| `device_uuid` | TEXT | - | 服务器分配的设备 UUID |
| `last_sync_at` | INTEGER | - | 最后同步时间 |
| `last_sync_status` | TEXT | CHECK | success, failed, never |
| `created_at` | INTEGER | NOT NULL | 创建时间 |
| `updated_at` | INTEGER | NOT NULL | 更新时间 |

**设计说明**:
- 使用 `CHECK (id = 1)` 约束确保表中只有一条记录
- 每次启动应用时，同步服务器信息到此表
- 用于生成同步请求时获取设备标识

---

### 3. sync_queue 表 - 同步队列

管理事件同步状态和失败重试机制。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PRIMARY KEY | 自增主键 |
| `event_id` | INTEGER | FOREIGN KEY | 关联 events.id |
| `retry_count` | INTEGER | NOT NULL, DEFAULT 0 | 已重试次数 |
| `max_retries` | INTEGER | NOT NULL, DEFAULT 5 | 最大重试次数 |
| `last_error` | TEXT | - | 最后一次失败原因 |
| `status` | TEXT | NOT NULL | pending, processing, failed, success |
| `created_at` | INTEGER | NOT NULL | 创建时间 |
| `updated_at` | INTEGER | NOT NULL | 更新时间 |
| `processed_at` | INTEGER | - | 成功处理时间 |

**工作流程**:
1. 新事件插入 → 触发器自动添加到 sync_queue (status=pending)
2. 同步服务查询 pending 任务 → 标记为 processing
3. 同步成功 → status=success, processed_at=当前时间
4. 同步失败 → status=failed, retry_count++, last_error=原因
5. 定期重试 → retry_count < max_retries 的 failed 任务

**查询性能预估**:
- 获取待同步任务: **SELECT * FROM sync_queue WHERE status='pending' ORDER BY created_at LIMIT 100**
  - 使用 `idx_sync_queue_status` 索引: **O(log n + 100)**
- 更新任务状态: **O(1)** (通过主键)

---

### 4. sync_history 表 - 同步历史

记录每次同步操作的详细信息，用于调试和统计分析。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PRIMARY KEY | 自增主键 |
| `sync_type` | TEXT | CHECK | upload, download, bidirectional |
| `events_count` | INTEGER | NOT NULL, DEFAULT 0 | 同步事件数量 |
| `status` | TEXT | CHECK | success, failed, partial |
| `start_timestamp` | INTEGER | NOT NULL | 同步数据起始时间 |
| `end_timestamp` | INTEGER | NOT NULL | 同步数据结束时间 |
| `error_message` | TEXT | - | 错误摘要 |
| `error_details` | TEXT | - | 详细错误信息 |
| `started_at` | INTEGER | NOT NULL | 同步开始时间 |
| `completed_at` | INTEGER | - | 同步完成时间 |

**用途**:
- 调试同步问题
- 生成同步统计报表
- 监控同步健康度

---

## 索引设计

### 索引列表

| 索引名 | 表 | 字段 | 用途 |
|--------|-----|------|------|
| `idx_events_timestamp` | events | timestamp DESC | 时间范围查询 |
| `idx_events_synced` | events | synced, timestamp | 查找未同步事件 |
| `idx_events_type` | events | event_type, timestamp | 按类型查询 |
| `idx_events_app_name` | events | app_name, timestamp | 应用统计 |
| `idx_events_category` | events | category, timestamp | 分类统计 |
| `idx_events_synced_timestamp` | events | synced, timestamp DESC | 同步查询优化 |
| `idx_sync_queue_status` | sync_queue | status, created_at | 待同步任务 |
| `idx_sync_queue_event_id` | sync_queue | event_id | 按事件查找 |
| `idx_sync_queue_retry` | sync_queue | status, retry_count | 重试任务 |
| `idx_sync_history_started_at` | sync_history | started_at DESC | 历史查询 |
| `idx_sync_history_status` | sync_history | status, started_at | 成功率统计 |

### 索引优化原则

**为什么这些索引**:

1. **`idx_events_timestamp`** - 最常用的时间范围查询
   - 查询: `SELECT * FROM events WHERE timestamp BETWEEN ? AND ?`
   - 性能: **O(log n)** vs 全表扫描 **O(n)**

2. **`idx_events_synced`** - 同步时查找未同步事件
   - 查询: `SELECT * FROM events WHERE synced = 0 ORDER BY timestamp LIMIT 1000`
   - 性能: **O(log n + 1000)**

3. **复合索引 `idx_events_synced_timestamp`** - 优化同步查询
   - 相比单列索引，避免回表操作
   - 查询计划: Index Scan + 回表只取需要的行

4. **`idx_sync_queue_status`** - 同步队列管理
   - 查询: `SELECT * FROM sync_queue WHERE status = 'pending' LIMIT 100`
   - 性能: **O(log n + 100)**

**索引开销**:
- 每个索引占用额外存储空间（约 20-30% 表大小）
- INSERT/UPDATE 操作需要更新所有索引
- **权衡**: 查询性能 >> 写入性能（本场景读多写少）

---

## 触发器

### 1. 自动更新 updated_at

```sql
CREATE TRIGGER update_device_info_updated_at
AFTER UPDATE ON device_info
FOR EACH ROW
BEGIN
    UPDATE device_info SET updated_at = (strftime('%s', 'now') * 1000) WHERE id = 1;
END;
```

**作用**: 自动维护 `updated_at` 字段

---

### 2. 自动添加同步任务

```sql
CREATE TRIGGER add_event_to_sync_queue
AFTER INSERT ON events
BEGIN
    INSERT INTO sync_queue (event_id, status)
    VALUES (NEW.id, 'pending');
END;
```

**作用**: 新事件自动加入同步队列，无需手动调用

**性能影响**: 每次插入额外一次 INSERT 操作，约 **1-2ms**

---

### 3. 自动更新同步状态

```sql
CREATE TRIGGER update_sync_queue_on_sync
AFTER UPDATE OF synced ON events
WHEN NEW.synced = 1 AND OLD.synced = 0
BEGIN
    UPDATE sync_queue
    SET status = 'success', processed_at = (strftime('%s', 'now') * 1000)
    WHERE event_id = NEW.id AND status != 'success';
END;
```

**作用**: 事件标记为已同步时，自动更新队列状态

---

## 视图

### 1. v_sync_stats - 同步统计

```sql
CREATE VIEW v_sync_stats AS
SELECT
    COUNT(CASE WHEN synced = 0 THEN 1 END) AS pending_events,
    COUNT(CASE WHEN synced = 1 THEN 1 END) AS synced_events,
    COUNT(*) AS total_events,
    MIN(timestamp) AS oldest_pending_timestamp,
    MAX(timestamp) AS latest_event_timestamp
FROM events;
```

**用途**: 快速查看同步状态

---

### 2. v_sync_queue_stats - 队列状态

```sql
CREATE VIEW v_sync_queue_stats AS
SELECT
    status,
    COUNT(*) AS count,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
FROM sync_queue
GROUP BY status;
```

**用途**: 监控同步队列健康度

---

### 3. v_daily_stats - 每日统计

```sql
CREATE VIEW v_daily_stats AS
SELECT
    DATE(timestamp / 1000, 'unixepoch', 'localtime') AS date,
    event_type,
    COUNT(*) AS event_count,
    SUM(duration) AS total_duration,
    COUNT(DISTINCT app_name) AS unique_apps
FROM events
GROUP BY date, event_type
ORDER BY date DESC, event_type;
```

**用途**: 生成每日活动报表

---

## 查询优化建议

### 常用查询模式

#### 1. 时间范围查询（最常见）

```sql
-- 查询最近 24 小时的事件
SELECT * FROM events
WHERE timestamp >= ? - 86400000
ORDER BY timestamp DESC;
```

**性能**: 使用 `idx_events_timestamp`，**O(log n + k)**

---

#### 2. 获取待同步事件

```sql
-- 批量获取未同步事件（用于同步）
SELECT id, event_type, timestamp, encrypted_data, nonce, auth_tag
FROM events
WHERE synced = 0
ORDER BY timestamp ASC
LIMIT 1000;
```

**性能**: 使用 `idx_events_synced_timestamp`，**O(log n + 1000)**

---

#### 3. 按应用统计

```sql
-- 统计各应用使用时长
SELECT app_name, SUM(duration) AS total_duration
FROM events
WHERE timestamp BETWEEN ? AND ?
  AND event_type = 'app_usage'
GROUP BY app_name
ORDER BY total_duration DESC;
```

**性能**: 使用 `idx_events_app_name`，**O(log n + k)**

---

#### 4. 同步队列管理

```sql
-- 获取待处理任务
SELECT * FROM sync_queue
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 100;

-- 标记为处理中
UPDATE sync_queue
SET status = 'processing'
WHERE id IN (?, ?, ...);
```

**性能**: 使用 `idx_sync_queue_status`，**O(log n + 100)**

---

### 查询优化技巧

1. **使用参数化查询**: 避免 SQL 注入，提升性能
2. **批量操作**: 使用事务包装多个 INSERT/UPDATE
3. **避免 SELECT ***: 只查询需要的列
4. **使用 EXPLAIN QUERY PLAN**: 分析查询计划
5. **定期 ANALYZE**: 更新统计信息，优化查询计划

---

## 性能基准测试

### 预期性能指标

| 操作 | 预期性能 | 说明 |
|------|----------|------|
| 插入单条事件 | < 5ms | 包含触发器开销 |
| 批量插入 100 条事件 | < 100ms | 使用事务 |
| 时间范围查询 (1天数据) | < 50ms | ~1000 条记录 |
| 获取待同步事件 (1000条) | < 100ms | 使用索引 |
| 按应用统计 | < 200ms | 聚合查询 |
| 数据库文件大小 (1天) | ~1 MB | 约 1000 条事件 |
| 数据库文件大小 (1月) | ~30 MB | 约 30000 条事件 |

### 性能测试建议

```rust
// 使用 criterion.rs 进行基准测试
#[bench]
fn bench_insert_event(b: &mut Bencher) {
    b.iter(|| {
        // 插入事件测试
    });
}

#[bench]
fn bench_query_by_timerange(b: &mut Bencher) {
    b.iter(|| {
        // 时间范围查询测试
    });
}
```

---

## 数据维护策略

### 1. 定期清理

**同步历史清理**:
```sql
-- 删除 30 天前的同步历史
DELETE FROM sync_history
WHERE started_at < (strftime('%s', 'now') * 1000) - (30 * 86400000);
```

**失败任务清理**:
```sql
-- 删除 7 天前且已达最大重试次数的失败任务
DELETE FROM sync_queue
WHERE status = 'failed'
  AND retry_count >= max_retries
  AND created_at < (strftime('%s', 'now') * 1000) - (7 * 86400000);
```

---

### 2. 数据归档

**建议策略**:
- 保留最近 3 个月数据在主数据库
- 超过 3 个月的数据归档到独立文件
- 旧数据可从服务器查询或加载归档文件

**归档 SQL**:
```sql
-- 导出到归档文件
ATTACH DATABASE 'archive_2024_01.db' AS archive;
INSERT INTO archive.events
SELECT * FROM events
WHERE timestamp < ? AND synced = 1;
DELETE FROM events WHERE timestamp < ? AND synced = 1;
DETACH DATABASE archive;
```

---

### 3. 定期维护

```sql
-- 分析索引统计信息
ANALYZE;

-- 重建索引
REINDEX;

-- 清理空闲空间
VACUUM;

-- 建议：每周执行一次
```

---

## 安全性

### 加密策略

**AES-256-GCM 加密流程**:
1. 生成随机 nonce (12 bytes)
2. 使用用户密钥加密事件 JSON 数据
3. 获得 auth_tag (16 bytes)
4. 存储: `encrypted_data` + `nonce` + `auth_tag`

**解密流程**:
1. 读取 `encrypted_data`, `nonce`, `auth_tag`
2. 使用用户密钥 + nonce 解密
3. 验证 auth_tag
4. 返回原始 JSON

**密钥管理**:
- 用户密钥使用派生函数 (PBKDF2/Argon2)
- 密钥存储在系统密钥链 (Windows Credential Manager)
- 永不存储在明文

---

### 数据分类

| 数据类型 | 存储方式 | 示例 |
|---------|---------|------|
| 公开 | 明文 | app_name, category, timestamp |
| 私有 | 加密 | url, filePath, windowTitle |
| 敏感 | 不上传 | email/chat 内容 |

---

## 与服务器端数据同步

### 同步协议

```typescript
// 同步请求
interface SyncRequest {
  deviceId: string;
  deviceInfo: {
    deviceName: string;
    osVersion: string;
    appVersion: string;
  };
  events: EncryptedEvent[];
  lastSyncAt: number;
}

// 同步响应
interface SyncResponse {
  success: boolean;
  processedCount: number;
  userId?: string;
  deviceUuid?: string;
  serverUpdates?: EncryptedEvent[];
  error?: string;
}
```

### 同步流程

```
1. 本地收集事件 → 存入 events 表（synced=0）
2. 同步服务定时扫描 → 查询 synced=0 的记录
3. 批量上传到服务器（100 条/批次）
4. 服务器返回成功 → 更新 synced=1, synced_at=now
5. 同步队列自动标记为 success
6. 记录同步历史到 sync_history
```

---

## 故障恢复

### 数据库损坏恢复

```bash
# SQLite 数据完整性检查
sqlite3 collector.db "PRAGMA integrity_check;"

# 如果损坏，尝试恢复
sqlite3 collector.db ".recover" | sqlite3 recovered.db

# 从备份恢复
cp backup/collector.db.2024-01-15 collector.db
```

### 同步失败恢复

1. 检查 `sync_queue` 表中的失败记录
2. 查看 `last_error` 字段了解失败原因
3. 如果是网络问题，自动重试
4. 如果是数据格式问题，删除问题记录，记录日志
5. 如果超过最大重试次数，标记为永久失败

---

## 后续优化方向

### 短期优化

1. **添加缓存层**: 使用 Redis 缓存热点数据（待同步事件）
2. **批量操作优化**: 增大批量插入/查询的批次大小
3. **异步写入**: 使用后台线程处理数据库写入

### 长期优化

1. **分区策略**: 按月分区（手动实现，SQLite 不支持原生分区）
2. **压缩存储**: 使用 Zstandard 压缩 `encrypted_data`
3. **增量同步**: 只同步变更的数据，减少网络传输

---

## 参考资料

- [SQLite Official Documentation](https://www.sqlite.org/docs.html)
- [SQLite Query Optimization](https://www.sqlite.org/queryplanner.html)
- [AES-GCM Encryption (RFC 5116)](https://datatracker.ietf.org/doc/html/rfc5116)
- [PostgreSQL Server Schema](../schema/001_initial_schema.sql)

---

**文档维护**: Database Agent
**最后更新**: 2026-02-26
