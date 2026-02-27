# PostgreSQL Schema Documentation

Lifespan Extension Project - Complete Database Schema Reference

---

## Table of Contents

1. [Overview](#overview)
2. [Core Tables](#core-tables)
3. [Event System](#event-system)
4. [Timeline & Analysis](#timeline--analysis)
5. [AI Memory System](#ai-memory-system)
6. [Sync & Tasks](#sync--tasks)
7. [Indexes](#indexes)
8. [Views](#views)
9. [Functions](#functions)
10. [Partitioning Strategy](#partitioning-strategy)

---

## Overview

### Database Specifications

- **Database Engine**: PostgreSQL 16+
- **Extensions**: `pgvector`, `uuid-ossp`
- **Primary Keys**: UUID v4 (random) for most tables
- **Timestamps**: All timestamps stored as `TIMESTAMP WITH TIME ZONE`
- **Encoding**: UTF-8
- **Collation**: en_US.UTF-8

### Design Principles

1. **Privacy-First**: Sensitive data encrypted at application level before storage
2. **Partition-Ready**: Events table partitioned by month for scalability
3. **Vector-Enabled**: pgvector indexes for semantic search
4. **Audit-Ready**: Comprehensive logging and tracking
5. **Multi-Tenant**: Row-level security ready (user_id on all tables)

### Entity Relationship Overview

```
users (1) ----< (N) devices
users (1) ----< (N) events [partitioned]
users (1) ----< (1) user_portraits [versioned]
users (1) ----< (N) timelines
users (1) ----< (N) working_memory
users (1) ----< (N) short_term_memory
users (1) ----< (N) long_term_memory
users (1) ----< (N) sync_records
users (1) ----< (N) analysis_tasks
users (1) ----< (N) user_preferences
users (1) ----< (N) audit_logs

devices (1) ----< (N) events
devices (1) ----< (N) sync_records
```

---

## Core Tables

### users

User account and authentication data.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() | User unique identifier |
| username | VARCHAR(50) | UNIQUE, NOT NULL | Username |
| email | VARCHAR(255) | UNIQUE, NOT NULL | Email address |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt/argon2 hash |
| timezone | VARCHAR(50) | DEFAULT 'Asia/Shanghai' | User timezone |
| language | VARCHAR(10) | DEFAULT 'zh-CN' | UI language |
| public_key | TEXT | NULL | Public key for E2E encryption |
| encryption_version | VARCHAR(20) | DEFAULT 'v1' | Encryption protocol version |
| is_active | BOOLEAN | DEFAULT true | Account status |
| is_verified | BOOLEAN | DEFAULT false | Email verification status |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Account creation time |
| updated_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Last update time |
| last_sync_at | TIMESTAMPTZ | NULL | Last device sync time |
| metadata | JSONB | DEFAULT '{}' | Additional user data |

**Indexes**:
- `idx_users_email` (email)
- `idx_users_username` (username)
- `idx_users_is_active` (is_active)
- `idx_users_created_at` (created_at DESC)

**Triggers**:
- `update_users_updated_at` - Auto-update updated_at on row modification

---

### devices

Multi-device management for cross-platform sync.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() | Device unique identifier |
| user_id | UUID | FK(users), NOT NULL | Owner user ID |
| device_name | VARCHAR(100) | NOT NULL | Device display name |
| device_type | VARCHAR(20) | CHECK, NOT NULL | 'windows', 'android', 'ios', 'macos' |
| device_id | VARCHAR(255) | NOT NULL | Hardware/OS device ID |
| os_version | VARCHAR(50) | NULL | OS version |
| app_version | VARCHAR(20) | NULL | Collector app version |
| is_active | BOOLEAN | DEFAULT true | Device active status |
| last_seen_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Last activity |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Registration time |
| updated_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Last update |

**Constraints**:
- UNIQUE(user_id, device_id)
- CHECK device_type IN ('windows', 'android', 'ios', 'macos')

**Indexes**:
- `idx_devices_user_id` (user_id)
- `idx_devices_device_id` (device_id)
- `idx_devices_user_active` (user_id, is_active)

**Triggers**:
- `update_devices_updated_at` - Auto-update updated_at

---

## Event System

### events (Partitioned)

Core time-series event storage with monthly partitioning.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK part, DEFAULT uuid_generate_v4() | Event ID |
| user_id | UUID | NOT NULL | Owner user |
| device_id | UUID | NOT NULL | Source device |
| event_type | VARCHAR(50) | CHECK, NOT NULL | Event type |
| timestamp | TIMESTAMPTZ | PK part, NOT NULL | Event time |
| duration | INTEGER | CHECK >= 0 | Duration in seconds |
| encrypted_data | BYTEA | NOT NULL | Encrypted event details |
| iv | VARCHAR(255) | NOT NULL | Encryption IV |
| auth_tag | VARCHAR(255) | NULL | Auth tag |
| app_name | VARCHAR(255) | NULL | App name (searchable) |
| category | VARCHAR(50) | CHECK | Category |
| domain | VARCHAR(255) | NULL | Domain (for web) |
| metadata | JSONB | DEFAULT '{}' | Additional data |
| synced_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Server sync time |
| processed | BOOLEAN | DEFAULT false | AI analysis flag |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Insert time |

**Event Types**:
- `app_usage` - Application/window focus
- `web_activity` - Web browsing
- `file_activity` - File operations
- `communication` - Messages/emails

**Categories**:
- `work` - Productivity applications
- `communication` - Communication tools
- `entertainment` - Entertainment/media
- `learning` - Education/learning
- `utility` - System utilities
- `other` - Uncategorized

**Partitioning**:
- Partition by RANGE (timestamp)
- One partition per month
- Format: `events_YYYY_MM` (e.g., `events_2026_02`)

**Indexes** (inherited by partitions):
- `idx_events_user_id` (user_id)
- `idx_events_device_id` (device_id)
- `idx_events_timestamp` (timestamp DESC)
- `idx_events_event_type` (event_type)
- `idx_events_category` (category)
- `idx_events_user_timestamp` (user_id, timestamp DESC) ⭐
- `idx_events_processed` (processed) WHERE processed = false
- `idx_events_metadata` (metadata) GIN
- `idx_events_user_type_timestamp` (user_id, event_type, timestamp DESC)
- `idx_events_user_category_timestamp` (user_id, category, timestamp DESC)

**Key Design Notes**:
- `encrypted_data` contains full event details (URLs, titles, etc.)
- `app_name`, `category`, `domain` are plaintext for filtering/aggregation
- Partition pruning works when querying with timestamp ranges
- Use `get_user_events()` function for optimized queries

---

## Timeline & Analysis

### timelines

Pre-aggregated daily timelines with AI insights.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() | Timeline ID |
| user_id | UUID | FK(users), NOT NULL | Owner user |
| date | DATE | NOT NULL | Timeline date |
| start_time | TIMESTAMPTZ | NOT NULL | First event time |
| end_time | TIMESTAMPTZ | NOT NULL | Last event time |
| total_duration | INTEGER | CHECK >= 0 | Total seconds |
| total_work_hours | DECIMAL(5,2) | DEFAULT 0 | Work hours |
| total_focus_hours | DECIMAL(5,2) | DEFAULT 0 | Deep work hours |
| context_switches | INTEGER | DEFAULT 0 | Task switches |
| productivity_score | DECIMAL(3,2) | CHECK 0-1 | Productivity 0-1 |
| category_stats | JSONB | DEFAULT '{}' | Time by category |
| app_usage_stats | JSONB | DEFAULT '{}' | Time by app |
| segments | JSONB | DEFAULT '[]' | Timeline segments |
| ai_insights | TEXT | NULL | AI analysis |
| ai_generated_at | TIMESTAMPTZ | NULL | Analysis time |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Creation time |
| updated_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Update time |

**Constraints**:
- UNIQUE(user_id, date)

**Indexes**:
- `idx_timelines_user_id` (user_id)
- `idx_timelines_date` (user_id, date DESC)
- `idx_timelines_productivity` (user_id, productivity_score DESC)
- `idx_timelines_category_stats` (category_stats) GIN
- `idx_timelines_app_usage_stats` (app_usage_stats) GIN

**Triggers**:
- `update_timelines_updated_at` - Auto-update updated_at

**JSONB Structure**:
```json
// category_stats
{
  "work": 14400,
  "communication": 3600,
  "entertainment": 1800
}

// app_usage_stats
{
  "VSCode": 7200,
  "Chrome": 5400,
  "Slack": 1800
}

// segments
[
  {
    "startTime": "2026-02-26T09:00:00Z",
    "endTime": "2026-02-26T11:30:00Z",
    "activity": "Deep Work",
    "category": "work",
    "apps": ["VSCode", "Terminal"]
  }
]
```

---

### user_portraits

AI-generated user behavior profiles with versioning.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT uuid_generate_v4() | Portrait ID |
| user_id | UUID | FK(users), NOT NULL | Owner user |
| version | INTEGER | DEFAULT 1, CHECK > 0 | Version number |
| previous_version_id | UUID | FK(self), NULL | Previous version |
| profile | JSONB | DEFAULT '{}' | User profile |
| patterns | JSONB | DEFAULT '{}' | Behavior patterns |
| interests | JSONB | DEFAULT '{}' | User interests |
| habits | JSONB | DEFAULT '{}' | User habits |
| relationships | JSONB | DEFAULT '{}' | Social patterns |
| goals | JSONB | DEFAULT '{}' | User goals |
| embedding | vector(1536) | NULL | Vector embedding |
| data_points_count | INTEGER | DEFAULT 0 | Events analyzed |
| confidence_score | DECIMAL(3,2) | CHECK 0-1 | Analysis confidence |
| ai_model | VARCHAR(50) | DEFAULT 'glm-4' | AI model used |
| ai_insights | TEXT | NULL | AI explanation |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Creation time |
| updated_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Update time |

**Constraints**:
- UNIQUE(user_id, version)

**Indexes**:
- `idx_user_portraits_user_id` (user_id)
- `idx_user_portraits_version` (user_id, version DESC)
- `idx_user_portraits_embedding` (embedding) IVFFlat
- `idx_user_portraits_profile` (profile) GIN
- `idx_user_portraits_patterns` (patterns) GIN

**Triggers**:
- `update_user_portraits_updated_at` - Auto-update updated_at

---

## AI Memory System

### working_memory

Short-term context storage (minutes to hours).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Memory ID |
| user_id | UUID | FK(users), NOT NULL | Owner user |
| memory_type | VARCHAR(50) | CHECK, NOT NULL | 'context', 'task', 'conversation' |
| content | TEXT | NOT NULL | Memory content |
| metadata | JSONB | DEFAULT '{}' | Additional data |
| expires_at | TIMESTAMPTZ | NOT NULL | Expiration time |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Creation time |

**Indexes**:
- `idx_working_memory_user_id` (user_id)
- `idx_working_memory_expires_at` (expires_at)
- `idx_working_memory_user_type` (user_id, memory_type)

**Cleanup**: Auto-delete expired entries via application job

---

### short_term_memory

Recent activities and preferences (7-30 days).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Memory ID |
| user_id | UUID | FK(users), NOT NULL | Owner user |
| memory_type | VARCHAR(50) | CHECK | 'recent_activity', 'preference', 'pattern' |
| title | VARCHAR(255) | NULL | Memory title |
| content | TEXT | NOT NULL | Memory content |
| metadata | JSONB | DEFAULT '{}' | Additional data |
| importance | DECIMAL(3,2) | CHECK 0-1 | Importance score |
| access_count | INTEGER | DEFAULT 0 | Access frequency |
| embedding | vector(1536) | NULL | Vector embedding |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Creation time |
| updated_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Update time |

**Indexes**:
- `idx_short_term_memory_user_id` (user_id)
- `idx_short_term_memory_importance` (importance DESC)
- `idx_short_term_memory_created_at` (created_at DESC)
- `idx_short_term_memory_embedding` (embedding) IVFFlat

**Triggers**:
- `update_short_term_memory_updated_at` - Auto-update updated_at

---

### long_term_memory

Persistent knowledge base with semantic search.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Memory ID |
| user_id | UUID | FK(users), NOT NULL | Owner user |
| memory_type | VARCHAR(50) | CHECK | 'fact', 'preference', 'relationship', 'expertise' |
| title | VARCHAR(255) | NOT NULL | Memory title |
| content | TEXT | NOT NULL | Memory content |
| metadata | JSONB | DEFAULT '{}' | Additional data |
| importance | DECIMAL(3,2) | DEFAULT 0.8 | Importance score |
| access_count | INTEGER | DEFAULT 0 | Access frequency |
| last_accessed_at | TIMESTAMPTZ | NULL | Last access |
| embedding | vector(1536) | NULL | Vector embedding |
| related_memories | UUID[] | DEFAULT [] | Related IDs |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Creation time |
| updated_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Update time |

**Indexes**:
- `idx_long_term_memory_user_id` (user_id)
- `idx_long_term_memory_type` (memory_type)
- `idx_long_term_memory_importance` (importance DESC)
- `idx_long_term_memory_embedding` (embedding) IVFFlat
- `idx_long_term_memory_content` (to_tsvector('english', content)) GIN

**Triggers**:
- `update_long_term_memory_updated_at` - Auto-update updated_at

---

## Sync & Tasks

### sync_records

Cross-device sync tracking.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Sync record ID |
| user_id | UUID | FK(users), NOT NULL | Owner user |
| device_id | UUID | FK(devices), NOT NULL | Source device |
| sync_type | VARCHAR(20) | CHECK | 'upload', 'download', 'bidirectional' |
| events_count | INTEGER | DEFAULT 0 | Events synced |
| status | VARCHAR(20) | CHECK | 'pending', 'success', 'failed' |
| start_time | TIMESTAMPTZ | NOT NULL | Sync start |
| end_time | TIMESTAMPTZ | NOT NULL | Sync end |
| error_message | TEXT | NULL | Error details |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Creation time |
| completed_at | TIMESTAMPTZ | NULL | Completion time |

**Indexes**:
- `idx_sync_records_user_id` (user_id)
- `idx_sync_records_device_id` (device_id)
- `idx_sync_records_status` (status)
- `idx_sync_records_created_at` (created_at DESC)

---

### analysis_tasks

AI analysis job queue.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Task ID |
| user_id | UUID | FK(users), NOT NULL | Owner user |
| task_type | VARCHAR(50) | CHECK | Task type |
| priority | INTEGER | DEFAULT 5, CHECK 1-10 | Priority (10=highest) |
| input_data | JSONB | NOT NULL | Task input |
| status | VARCHAR(20) | DEFAULT 'pending' | 'pending', 'processing', 'completed', 'failed' |
| result | JSONB | NULL | Task output |
| error_message | TEXT | NULL | Error details |
| retry_count | INTEGER | DEFAULT 0 | Retry attempts |
| max_retries | INTEGER | DEFAULT 3 | Max retries |
| ai_model | VARCHAR(50) | DEFAULT 'glm-4-flash' | AI model |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Creation time |
| started_at | TIMESTAMPTZ | NULL | Start time |
| completed_at | TIMESTAMPTZ | NULL | Completion time |

**Task Types**:
- `portrait_analysis` - Generate user portrait
- `pattern_extraction` - Extract behavior patterns
- `insight_generation` - Generate insights

**Indexes**:
- `idx_analysis_tasks_user_id` (user_id)
- `idx_analysis_tasks_status_priority` (status, priority DESC)
- `idx_analysis_tasks_created_at` (created_at)
- `idx_analysis_tasks_user_status` (user_id, status)

---

### user_preferences

User settings and preferences.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Preference ID |
| user_id | UUID | FK(users), NOT NULL | Owner user |
| preference_key | VARCHAR(100) | NOT NULL | Setting key |
| preference_value | JSONB | NOT NULL | Setting value |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Creation time |
| updated_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Update time |

**Constraints**:
- UNIQUE(user_id, preference_key)

**Indexes**:
- `idx_user_preferences_user_id` (user_id)
- `idx_user_preferences_key` (preference_key)

**Triggers**:
- `update_user_preferences_updated_at` - Auto-update updated_at

---

### audit_logs

Security and compliance logging.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Log ID |
| user_id | UUID | NULL | Acting user |
| action | VARCHAR(100) | NOT NULL | Action performed |
| resource_type | VARCHAR(50) | NOT NULL | Resource type |
| resource_id | UUID | NULL | Resource ID |
| ip_address | INET | NULL | Client IP |
| user_agent | TEXT | NULL | Client UA |
| metadata | JSONB | DEFAULT '{}' | Additional data |
| created_at | TIMESTAMPTZ | DEFAULT CURRENT_TIMESTAMP | Log time |

**Indexes**:
- `idx_audit_logs_user_id` (user_id)
- `idx_audit_logs_action` (action)
- `idx_audit_logs_resource` (resource_type, resource_id)
- `idx_audit_logs_created_at` (created_at DESC)

---

## Indexes

### Index Types

| Type | Use Case | Example |
|------|----------|---------|
| B-tree | Default, equality/range | user_id, timestamp |
| GIN | JSONB, arrays | metadata, segments |
| IVFFlat | Vector similarity | embedding |
| Partial | Conditional indexing | WHERE processed = false |

### Index Strategy

**Primary Access Patterns**:
1. User-based queries → `user_id` indexes
2. Time-based queries → `timestamp` DESC indexes
3. Type filters → `event_type`, `category` indexes
4. JSONB searches → GIN indexes
5. Vector search → IVFFlat with cosine distance

**Composite Indexes** (used for multi-column queries):
- `(user_id, timestamp DESC)` - Most common pattern
- `(user_id, event_type, timestamp DESC)` - Type-filtered queries
- `(user_id, category, timestamp DESC)` - Category queries

**Partial Indexes** (save space, target hot data):
- `WHERE processed = false` - Unprocessed events only

---

## Views

### user_overview

Aggregated user statistics.

```sql
CREATE VIEW user_overview AS
SELECT
    u.id, u.username, u.email,
    u.created_at, u.last_sync_at,
    COUNT(DISTINCT d.id) AS device_count,
    COUNT(DISTINCT e.id) AS total_events,
    MAX(e.timestamp) AS last_activity_at
FROM users u
LEFT JOIN devices d ON u.id = d.user_id AND d.is_active = true
LEFT JOIN events e ON u.id = e.user_id
WHERE u.is_active = true
GROUP BY u.id;
```

---

### latest_user_portraits

Most recent portrait per user.

```sql
CREATE VIEW latest_user_portraits AS
SELECT DISTINCT ON (user_id)
    user_id, version, profile, patterns,
    interests, habits, relationships, goals,
    embedding, confidence_score,
    created_at, updated_at
FROM user_portraits
ORDER BY user_id, version DESC;
```

---

## Functions

### create_monthly_partition(table_name, start_date)

Create a monthly partition for events table.

```sql
CREATE OR REPLACE FUNCTION create_monthly_partition(
    table_name text,
    start_date date
) RETURNS void;
```

**Usage**:
```sql
SELECT create_monthly_partition('events', date_trunc('month', CURRENT_DATE));
```

---

### cleanup_old_partitions(table_name, retention_months)

Drop partitions older than retention period.

```sql
CREATE OR REPLACE FUNCTION cleanup_old_partitions(
    table_name text,
    retention_months integer DEFAULT 12
) RETURNS void;
```

**Usage**:
```sql
SELECT cleanup_old_partitions('events', 12);
```

---

### get_user_events(user_id, start_date, end_date, event_type, limit)

Optimized user event retrieval with partition pruning.

```sql
CREATE OR REPLACE FUNCTION get_user_events(
    p_user_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_event_type VARCHAR DEFAULT NULL,
    p_limit INTEGER DEFAULT 100
) RETURNS TABLE (...);
```

**Usage**:
```sql
SELECT * FROM get_user_events(
    'user-uuid'::UUID,
    '2026-02-01'::TIMESTAMPTZ,
    '2026-02-28'::TIMESTAMPTZ,
    'app_usage',
    50
);
```

---

### maintain_partitions()

Create next 3 months of partitions.

```sql
CREATE OR REPLACE FUNCTION maintain_partitions() RETURNS void;
```

**Usage**: Run via cron monthly.

---

### update_updated_at_column()

Auto-update trigger function for updated_at columns.

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## Partitioning Strategy

### Events Table Partitioning

**Design**:
- Partition by RANGE (timestamp)
- One partition per month
- Format: `events_YYYY_MM` (e.g., `events_2026_02`, `events_2026_03`)

**Benefits**:
1. Query performance: Partition pruning for time-range queries
2. Maintenance: Drop/archive old partitions
3. Vacuum efficiency: Smaller individual tables
4. Parallel operations: Index builds per partition

**Partition Management**:

```sql
-- Create next month's partition
SELECT create_monthly_partition('events', date_trunc('month', CURRENT_DATE + interval '1 month'));

-- List partitions
SELECT tablename FROM pg_tables WHERE tablename LIKE 'events_%';

-- Drop old partition (12+ months old)
DROP TABLE IF EXISTS events_2025_01;
```

**Query Optimization**:

```sql
-- GOOD: Uses partition pruning
SELECT * FROM events
WHERE user_id = $1
  AND timestamp >= '2026-02-01'
  AND timestamp < '2026-03-01';

-- BAD: No partition pruning (no timestamp filter)
SELECT * FROM events WHERE user_id = $1;
```

**Cron Job** (monthly):

```bash
# crontab -e
0 0 1 * * psql -d lifespan -c "SELECT maintain_partitions();"
```

---

## Row Level Security (RLS)

### Enable RLS on Tables

```sql
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE timelines ENABLE ROW LEVEL SECURITY;
-- ... other tables

-- Policy: Users can only see their own data
CREATE POLICY user_isolation ON events
    FOR ALL
    USING (user_id = current_setting('app.user_id')::UUID);
```

**Usage**:
```sql
SET app.user_id = 'user-uuid';
SELECT * FROM events; -- Only returns user's events
```

---

## Data Retention

### Retention Policy

| Data Type | Retention | Archive/Delete |
|-----------|-----------|----------------|
| Events | 12 months | Archive to S3/ Glacier |
| Timelines | 3 years | Keep online |
| Working Memory | 24 hours | Delete |
| Short-term Memory | 90 days | Delete/move to long-term |
| Long-term Memory | Forever | Keep |
| Audit Logs | 1 year | Archive |
| Sync Records | 90 days | Delete |

---

## Migration Notes

### Applying Schema

```bash
# Up
psql -d lifespan -f migrations/001_initial_schema.up.sql

# Down
psql -d lifespan -f migrations/001_initial_schema.down.sql
```

### Verification

```sql
-- Check tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Check partitions
SELECT tablename FROM pg_tables WHERE tablename LIKE 'events_%';

-- Check indexes
SELECT indexname FROM pg_indexes WHERE schemaname = 'public';

-- Row counts
SELECT
    schemaname, tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Performance Considerations

### Query Patterns

**Use composite indexes** for multi-column queries:
```sql
-- Uses idx_events_user_timestamp
WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
```

**Avoid SELECT ***:
```sql
-- BAD: Fetches all columns
SELECT * FROM events WHERE user_id = ?;

-- GOOD: Fetch only needed columns
SELECT event_type, timestamp, duration FROM events WHERE user_id = ?;
```

**Use prepared statements**:
```javascript
// Good: Prepared statement
client.query('SELECT * FROM events WHERE user_id = $1', [userId]);

// Bad: String concatenation (SQL injection risk)
client.query(`SELECT * FROM events WHERE user_id = '${userId}'`);
```

---

## Troubleshooting

### Common Issues

**1. Partition not found**:
```sql
-- Error: no partition of relation "events" found for row
-- Solution: Create missing partition
SELECT create_monthly_partition('events', '2026-03-01'::DATE);
```

**2. Slow queries**:
```sql
-- Analyze query
EXPLAIN (ANALYZE, BUFFERS) <query>;

-- Check index usage
SELECT * FROM pg_stat_user_indexes WHERE schemaname = 'public';
```

**3. Disk space**:
```sql
-- Check table sizes
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size(tablename::regclass)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(tablename::regclass) DESC;

-- Check partition sizes
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size('public.'||tablename)) AS size
FROM pg_tables
WHERE tablename LIKE 'events_%'
ORDER BY pg_total_relation_size('public.'||tablename) DESC;
```

---

## References

- [PostgreSQL Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [Index Types](https://www.postgresql.org/docs/current/indexes-types.html)
- [Query Optimization](https://www.postgresql.org/docs/current/performance-tips.html)
