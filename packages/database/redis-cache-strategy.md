# Lifespan Redis 缓存策略

## 概述

Redis 在 Lifespan 项目中承担以下职责：
- 热点数据缓存
- 会话管理
- 实时数据队列
- 分布式锁
- 速率限制

---

## 一、缓存键命名规范

### 命名格式
```
{namespace}:{resource}:{identifier}:{field}
```

### 示例
```
lifespan:user:{user_id}:profile
lifespan:user:{user_id}:portrait
lifespan:timeline:{user_id}:{date}
lifespan:events:{user_id}:latest
lifespan:sync:{device_id}:lock
```

---

## 二、核心缓存策略

### 2.1 用户数据缓存

#### 用户基本信息
```
Key: lifespan:user:{user_id}:profile
Type: Hash
TTL: 3600s (1小时)
Fields:
  - id: UUID
  - username: string
  - email: string
  - timezone: string
  - created_at: timestamp
  - last_sync_at: timestamp
```

**更新策略**:
- 写穿透（Write-Through）：数据库更新时同步更新缓存
- 失效策略：用户信息变更时主动失效

#### 用户最新画像
```
Key: lifespan:user:{user_id}:portrait
Type: String (JSON)
TTL: 86400s (24小时)
Value: {UserPortrait JSON}
```

**更新策略**:
- 延迟双删：更新数据库时删除缓存，再次删除缓存（延迟500ms）
- 回源：缓存miss时从数据库加载并写入

#### 用户偏好设置
```
Key: lifespan:user:{user_id}:preferences
Type: Hash
TTL: 3600s (1小时)
```

---

### 2.2 事件数据缓存

#### 最新事件列表
```
Key: lifespan:user:{user_id}:events:latest
Type: List (ZSET by timestamp)
TTL: 300s (5分钟)
Value: [event_ids]
Max Length: 1000
```

**使用场景**:
- 实时Dashboard展示最新活动
- 快速查询最近1小时事件

#### 今日事件统计
```
Key: lifespan:user:{user_id}:stats:{date}
Type: Hash
TTL: 86400s (24小时，到午夜自动失效)
Fields:
  - total_events: count
  - total_duration: seconds
  - app_usage: JSON
  - category_breakdown: JSON
  - productivity_score: float
```

**更新策略**:
- 定时任务每5分钟从PostgreSQL聚合计算
- 或使用Write-Behind异步更新

#### 热门应用/域名（Top N）
```
Key: lifespan:user:{user_id}:top:{type}:{period}
Type: ZSET (sorted by usage)
TTL: 3600s (1小时)
type: 'apps' | 'domains'
period: 'today' | 'week' | 'month'
Score: duration
```

---

### 2.3 时间线缓存

#### 每日时间线
```
Key: lifespan:timeline:{user_id}:{date}
Type: String (JSON)
TTL: 604800s (7天)
Value: {Timeline JSON}
```

**预加载策略**:
- 用户登录时预加载最近7天
- 定时任务每天凌晨生成当日时间线

#### 时间线聚合数据
```
Key: lifespan:timeline:{user_id}:aggregate:{period}
Type: String (JSON)
TTL: 3600s (1小时)
period: 'week' | 'month' | 'year'
Value: {
  total_work_hours: float,
  productivity_trend: array,
  category_distribution: object,
  insights: array
}
```

---

### 2.4 设备管理

#### 设备在线状态
```
Key: lifespan:device:{device_id}:online
Type: String
TTL: 180s (3分钟，心跳刷新)
Value: last_seen_timestamp
```

#### 设备同步状态
```
Key: lifespan:device:{device_id}:sync_state
Type: Hash
TTL: 3600s
Fields:
  - last_sync_at: timestamp
  - pending_events_count: int
  - sync_status: 'idle' | 'syncing' | 'error'
```

---

### 2.5 会话管理

#### 用户会话
```
Key: lifespan:session:{session_id}
Type: Hash
TTL: 604800s (7天)
Fields:
  - user_id: UUID
  - device_id: UUID
  - created_at: timestamp
  - last_activity: timestamp
  - ip_address: string
```

#### 在线用户列表
```
Key: lifespan:online_users
Type: Set
TTL: None (手动管理)
Members: [user_ids]
```

---

### 2.6 同步机制

#### 分布式锁（防止重复同步）
```
Key: lifespan:sync:lock:{user_id}:{device_id}
Type: String
TTL: 300s (5分钟)
Value: {locked_at, locked_by, lock_token}
```

#### 待同步事件队列
```
Key: lifespan:sync:queue:{user_id}
Type: List
TTL: None (消费后删除)
Value: [event_ids]
```

---

### 2.7 AI分析缓存

#### AI分析结果缓存
```
Key: lifespan:ai:analysis:{task_type}:{hash(input_data)}
Type: String (JSON)
TTL: 86400s (24小时)
Value: {analysis_result}
```

**注意**: 对相同输入避免重复调用AI API

#### 用户画像生成缓存
```
Key: lifespan:ai:portrait:{user_id}:generation
Type: String (JSON)
TTL: 43200s (12小时)
Value: {
  status: 'generating' | 'completed' | 'failed',
  started_at: timestamp,
  progress: float
}
```

---

### 2.8 记忆系统缓存

#### 工作记忆（当前会话）
```
Key: lifespan:memory:working:{user_id}:{session_id}
Type: Hash
TTL: 3600s (1小时，会话结束删除)
Fields:
  - context: JSON
  - tasks: JSON
  - conversations: JSON
```

#### 语义搜索缓存
```
Key: lifespan:memory:search:{user_id}:{query_hash}
Type: List
TTL: 1800s (30分钟)
Value: [memory_ids]
```

---

## 三、速率限制

### API速率限制
```
Key: lifespan:ratelimit:{user_id}:{endpoint}
Type: String (INCR)
TTL: 60s (滑动窗口)
Value: request_count
```

**配置示例**:
- 同步API: 10次/分钟
- 查询API: 100次/分钟
- 分析API: 5次/分钟

### 设备心跳限制
```
Key: lifespan:ratelimit:device:{device_id}:heartbeat
Type: String (INCR)
TTL: 60s
Value: heartbeat_count
```

---

## 四、缓存更新策略

### 4.1 Cache-Aside (旁路缓存)
**适用场景**: 读多写少的数据（用户画像、时间线）

```
读取流程:
1. 查询Redis
2. Cache Hit → 返回
3. Cache Miss → 查询PostgreSQL → 写入Redis → 返回

写入流程:
1. 更新PostgreSQL
2. 删除Redis缓存
```

### 4.2 Write-Through (写穿透)
**适用场景**: 强一致性数据（用户信息、会话）

```
写入流程:
1. 同时更新PostgreSQL和Redis
2. 保证数据一致性
```

### 4.3 Write-Behind (异步写回)
**适用场景**: 统计数据、非关键数据

```
写入流程:
1. 更新Redis
2. 异步批量写入PostgreSQL
3. 提升写入性能
```

---

## 五、缓存过期策略

### 5.1 主动过期
- **数据更新时**: 立即删除相关缓存
- **用户登出时**: 清除会话缓存
- **数据删除时**: 级联删除缓存

### 5.2 被动过期
- **TTL到期**: Redis自动删除
- **内存淘汰**: allkeys-lru（ least recently used）

### 5.3 定时清理
- **每日凌晨**: 清理过期工作记忆
- **每周**: 清理旧的分析缓存
- **每月**: 清理未访问的搜索缓存

---

## 六、缓存预热

### 6.1 用户登录时预热
```
1. 加载用户基本信息
2. 加载最新用户画像
3. 加载最近7天时间线
4. 加载今日统计
```

### 6.2 定时任务预热
```
1. 每小时: 热门用户数据
2. 每天凌晨: 生成当日时间线
3. 每周一: 生成周报聚合数据
```

---

## 七、缓存监控指标

### 7.1 关键指标
```
- 缓存命中率 (Hit Rate): > 85%
- 平均响应时间: < 1ms
- 内存使用率: < 80%
- 错误率: < 0.1%
```

### 7.2 监控命令
```bash
# 缓存命中率
redis-cli info stats | grep keyspace_hits

# 内存使用
redis-cli info memory

# 慢查询
redis-cli slowlog get 10

# 连接数
redis-cli info clients
```

---

## 八、故障恢复

### 8.1 缓存降级
```
Redis不可用时的降级策略:
1. 所有请求直接访问PostgreSQL
2. 禁用非关键功能（实时统计、推荐）
3. 记录降级日志
4. Redis恢复后逐步预热
```

### 8.2 数据恢复
```
1. Redis重启后从数据库重建缓存
2. 优先恢复热点数据
3. 使用后台任务逐步填充
```

---

## 九、性能优化建议

### 9.1 连接池配置
```
最大连接数: 50
最小连接数: 10
连接超时: 5000ms
```

### 9.2 管道技术（Pipelining）
```
批量操作使用pipeline:
- 批量获取用户数据
- 批量更新统计
- 批量删除过期key
```

### 9.3 Lua脚本
```
原子操作使用Lua脚本:
- 速率限制检查
- 分布式锁获取
- 复杂缓存更新
```

### 9.4 内存优化
```
1. 使用Hash代替多个String
2. 压缩大对象（使用gzip）
3. 设置合理的TTL
4. 定期清理过期数据
```

---

## 十、安全建议

### 10.1 访问控制
```
1. Redis绑定内网IP
2. 设置强密码
3. 禁用危险命令（FLUSHALL, CONFIG）
4. 使用ACL控制权限
```

### 10.2 数据加密
```
1. 敏感数据加密后存储
2. 使用TLS传输加密
3. 定期轮换密钥
```

---

## 总结

本缓存策略针对 Lifespan 项目的特点设计：
- **本地优先**: 减少服务器压力
- **分层缓存**: 根据数据热度分级
- **智能预热**: 提升用户体验
- **降级保障**: 保证系统可用性
- **监控完善**: 及时发现问题
