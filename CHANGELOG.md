# 开发记录日志 - Lifespan Extension Project

**项目名称**: 人类寿命延长计划 (Lifespan Extension Project)
**开始日期**: 2026-02-25
**当前阶段**: Phase 1 - Windows Collector 开发
**最后更新**: 2026-02-27

---

## 📅 会话记录

### 2026-02-27 (第3天) - 并行测试与修复

#### ✅ 完成的任务

**1. 修复应用图标问题**
- 发现 `apps/desktop/src-tauri/icons/` 已有完整图标文件
- 状态: ✅ 已存在，无需修复

**2. Windows Collector 同步服务客户端**
- 实现完整的 HTTP 客户端 (`src/sync/client.rs`)
- JWT 认证集成
- 批量同步（100 事件/批次）
- 错误重试机制（指数退避）
- 新增 Tauri Commands: `sync_now`, `get_sync_status`, `set_server_config`, `get_server_config`
- 前端 UI 更新（同步状态、设置面板）

**3. 后端 Sync API 发现**
- 发现 `/api/v1/sync/events` 已完整实现
- 功能包括：上传、下载、状态查询
- 设备所有权验证、冲突检测、速率限制
- 性能优化：缓存、批量事务、慢查询日志

**4. 前端 UI 修复**
- 修复 Settings 页面 Name 输入框只读问题
- 添加 JWT Token 显示和复制按钮
- 修复后端 API 响应字段映射 (`access_token` → `token`)

**5. Windows Collector 默认配置**
- 预填充默认服务器地址: `http://localhost:3000`
- 自动加载已保存配置
- 简化用户输入（只需 token）

**6. 同步 API 路径修复**
- 修复错误的 API 路径: `/api/v1/sync` → `/api/v1/sync/events`

#### 📝 创建的文档

1. **`TESTING-GUIDE.md`** - 完整的端到端测试指南
2. **`PARALLEL-TEST-GUIDE.md`** - 并行测试 Web 和 Windows Collector
3. **`FIXES-QUICK-TEST.md`** - 快速修复说明和测试流程
4. **`parallel-test.bat`** - 一键启动脚本

#### 🔧 技术债务

- [ ] 自动同步调度器（每5分钟）
- [ ] 100+ 事件自动触发同步
- [ ] 加密密钥管理（用户密码派生）
- [ ] 设备 ID 自动生成（首次启动）
- [ ] 离线队列和重试机制

#### 📊 测试结果

**待测试**:
- Windows Collector 同步功能
- Web Dashboard JWT Token 显示
- 端到端数据流程
- 性能基准测试

---

## 🗂️ 文件变更记录

### 2026-02-27

#### 新建文件

```
packages/api/
├── src/validators/sync.schema.ts          # 同步 API 验证 schemas
├── src/routes/sync.ts                     # 同步路由（发现已存在）
├── src/services/sync.service.ts            # 同步服务（发现已存在）
├── src/cache/device.cache.ts               # 设备缓存（发现已存在）

packages/web/
└── src/pages/Settings.tsx                  # 设置页面（添加 JWT Token 显示）

apps/desktop/
├── src-tauri/src/sync/mod.rs               # 同步模块主文件
├── src-tauri/src/sync/client.rs            # 同步客户端实现
├── src/App.tsx                             # 更新配置加载逻辑
└── src-tauri/src/commands/mod.rs           # 添加 get_server_config 命令

项目根目录/
├── TESTING-GUIDE.md                         # 测试指南
├── PARALLEL-TEST-GUIDE.md                  # 并行测试指南
├── FIXES-QUICK-TEST.md                     # 修复说明
├── parallel-test.bat                       # 启动脚本
└── CHANGELOG.md                            # 本文件
```

#### 修改文件

```
apps/desktop/src-tauri/
├── src/sync/client.rs:285                  # 修复 API 路径
├── src/commands/mod.rs                     # 添加 get_server_config
└── src/main.rs                             # 注册新命令

packages/web/
├── src/lib/api.ts                          # 修复 token 字段映射
└── src/pages/Settings.tsx                  # 添加 JWT Token UI

packages/api/
└── src/routes/auth.ts                      # 修复 token 生成（jti 冲突）
```

---

## 🐛 已知问题与修复

### 问题 1: JWT Token 生成冲突
**错误**: `Bad "options.jwtid" option. The payload already has an "jti" property.`

**原因**: payload 中有 `jti`，但 options 中又指定 `jwtid`

**修复**:
```typescript
// packages/api/src/middleware/auth.ts
// 移除 payload 中的 jti，由 jwtid option 生成
export function generateAccessToken(payload: TokenInput): string {
  return jwt.sign(payload, secret, {
    expiresIn,
    jwtid: randomUUID(),  // jti 由库生成
  });
}
```

**影响文件**:
- `packages/api/src/middleware/auth.ts`
- `packages/api/src/routes/auth.ts`
- `packages/api/src/__tests__/**/*.ts` (多个测试文件)

### 问题 2: devices.device_id 字段不存在
**错误**: `column "device_id" of relation "devices" does not exist`

**原因**: 代码使用了不存在的 `device_id` 字段，schema 只有 `device_type`

**修复**:
```sql
-- 移除 device_id 字段，使用 device_type
-- UNIQUE 约束改为 (user_id, device_type)
```

**影响文件**:
- `packages/api/src/routes/auth.ts`
- `packages/api/src/__tests__/setup.ts`

### 问题 3: Sync API 404 错误
**错误**: `HTTP 404: {"error":"not_found","message":"Route POST /api/v1/sync not found"}`

**原因**: Windows Collector 调用 `/api/v1/sync`，但后端是 `/api/v1/sync/events`

**修复**:
```rust
// apps/desktop/src-tauri/src/sync/client.rs:285
let url = format!("{}/api/v1/sync/events", config.server_url.trim_end_matches('/'));
```

### 问题 4: JWT Token 未显示在 Web Dashboard
**原因**: 后端返回 `access_token`，前端期望 `token`

**修复**:
```typescript
// packages/web/src/lib/api.ts
login: (email, password) =>
  fetchAPI<{access_token: string, ...}>('/auth/login', {...})
    .then(response => ({
      token: response.access_token,  // 字段映射
      ...
    }))
```

### 问题 5: Settings 页面 Name 输入框只读
**原因**: 有 `value` 但没有 `onChange` 处理器

**修复**:
```typescript
// packages/web/src/pages/Settings.tsx
const [userName, setUserName] = useState(user?.name || '');

<Input
  value={userName}
  onChange={(e) => setUserName(e.target.value)}
/>
```

---

## 🔐 配置持久化方案

### Windows Collector 配置存储

**存储位置**: 本地 SQLite 数据库

**配置结构**:
```json
{
  "server_url": "http://localhost:3000",
  "jwt_token": "eyJhbGcOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "device_id": "uuid-v4"
}
```

**保存逻辑** (`src/sync/client.rs:122-133`):
```rust
pub async fn set_config(&self, config: ServerConfig) -> Result<()> {
    // 1. 序列化为 JSON
    let config_json = serde_json::to_string(&config)?;

    // 2. 保存到数据库
    self.db.set_setting("server_config", &config_json)?;

    // 3. 更新内存配置
    let mut config_guard = self.config.lock().await;
    *config_guard = Some(config);

    Ok(())
}
```

**加载逻辑** (`src/sync/client.rs:135-147`):
```rust
pub async fn get_config(&self) -> Result<Option<ServerConfig>> {
    // 1. 尝试从数据库加载
    if let Some(config_json) = self.db.get_setting("server_config")? {
        if let Ok(config) = serde_json::from_str::<ServerConfig>(&config_json) {
            return Ok(Some(config));
        }
    }

    // 2. 回退到内存配置
    let config_guard = self.config.lock().await;
    Ok(config_guard.clone())
}
```

**前端加载** (`apps/desktop/src/App.tsx:43-54`):
```typescript
// 组件挂载时加载配置
useEffect(() => {
  const loadConfig = async () => {
    try {
      const savedConfig = await invoke<ServerConfig>("get_server_config");
      if (savedConfig) {
        setServerConfig(savedConfig);
      }
    } catch (error) {
      console.error("Failed to load config:", error);
    }
  };
  loadConfig();
}, []);
```

### Web Dashboard 配置存储

**存储位置**: 浏览器 localStorage

**存储结构**:
```json
{
  "user": {
    "id": "uuid",
    "email": "test@lifespan.local",
    "name": "Test User"
  },
  "token": "eyJhbGcOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "isAuthenticated": true
}
```

**存储键**: `lifespan-user-storage`

---

## 📈 项目进度统计

### 代码量统计

```
 apps/desktop/
 ├── src-tauri/src/
 │   ├── collector/        ~400 行 Rust
 │   ├── sync/            ~600 行 Rust
 │   ├── database/        ~300 行 Rust
 │   ├── encryption/      ~200 行 Rust
 │   └── commands/        ~150 行 Rust
 └── src/                 ~300 行 TypeScript/React

 packages/api/
 ├── src/routes/          ~800 行 TypeScript
 ├── src/services/        ~500 行 TypeScript
 ├── src/middleware/      ~300 行 TypeScript
 └── src/validators/      ~200 行 TypeScript

 packages/web/
 └── src/                 ~1500 行 TypeScript/React

 packages/database/
 └── schema/              ~400 行 SQL

 packages/types/
 └── src/                 ~300 行 TypeScript

 总计: ~6000+ 行代码
```

### 测试覆盖

```
Windows Collector: 91 个测试用例
- 单元测试: 74
- 集成测试: 17
- 覆盖率: >80%

Web Dashboard: 待测试
API: 待测试
```

---

## 🎯 里程碑追踪

### Phase 1: Windows Collector (3周)

**Week 1: 基础** (Feb 26 - Mar 4)
- [x] 架构设计完成
- [x] Tauri 项目创建
- [x] Window Tracker 实现
- [x] Idle Detector 实现
- [x] Local Storage (SQLite)
- [x] 加密模块 (AES-256-GCM)
- [x] 同步服务客户端
- [ ] **M1: 本地存储完成** (Feb 28) - ⏳ 进行中

**Week 2: 采集 + 同步** (Mar 5 - Mar 11)
- [ ] 监听应用切换
- [ ] 记录使用时长
- [ ] 追踪网页浏览
- [ ] **M2: 服务器同步完成** (Mar 7)

**Week 3: 打磨 + 测试** (Mar 12 - Mar 18)
- [ ] 错误处理
- [ ] 性能优化
- [ ] 测试
- [ ] **M3: Alpha 版本** (Mar 14)
- [ ] **M4: Beta 版本** (Mar 21)

---

## 🔗 相关资源

### 技术文档
- [技术架构](./docs/01-technical-architecture.md)
- [Phase 1 架构设计](./docs/ADR-001-phase1-architecture.md)
- [数据库 Schema](./packages/database/schema/001_initial_schema_simple.sql)

### Agent 团队
- [Agent 使用指南](./agents/README.md)
- [协作案例](./agents/COLLABORATION-GUIDE.md)
- [团队总结](./agents/TEAM-SUMMARY.md)

### 测试文档
- [测试指南](./TESTING-GUIDE.md)
- [并行测试指南](./PARALLEL-TEST-GUIDE.md)
- [修复说明](./FIXES-QUICK-TEST.md)

---

## 📝 待办事项

### 立即任务 (P0)
- [ ] 完成端到端测试
- [ ] 验证配置持久化
- [ ] 性能基准测试
- [ ] 创建 Git 仓库并提交

### 短期任务 (P1)
- [ ] 实现自动同步调度器
- [ ] 实现事件数量自动触发
- [ ] 创建 Windows 安装程序
- [ ] 编写用户文档

### 中期任务 (P2)
- [ ] Web Dashboard 数据可视化
- [ ] AI 集成（行为分析）
- [ ] Android Collector 开发
- [ ] 性能优化

### 长期任务 (P3)
- [ ] 三层记忆系统
- [ ] AI 助理（任务执行）
- [ ] 边缘计算优化
- [ ] 多设备无缝协作

---

## 💡 经验教训

### 技术决策

1. **选择 Tauri 而非 Electron**
   - ✅ 优势: 15x 更小体积，4-10x 更少内存
   - ⚠️ 挑战: Rust 学习曲线（2-3 天可接受）

2. **本地优先 + 加密同步**
   - ✅ 优势: 离线可用、隐私保护
   - ⚠️ 复杂度: 需要处理同步冲突

3. **使用 Agent 团队**
   - ✅ 优势: 专业化分工、高质量代码
   - ⚠️ 挑战: 需要良好的协作机制

### 开发实践

1. **配置持久化**
   - ✅ 最佳实践: 数据库存储 + 内存缓存
   - ✅ 用户体验: 自动加载，无需重复输入

2. **错误处理**
   - ✅ 策略: 分层处理（网络/认证/服务器）
   - ✅ 用户体验: 清晰的错误信息

3. **API 设计**
   - ✅ 一致性: 统一的响应格式
   - ✅ 安全性: JWT 认证 + 设备验证

---

## 📞 联系信息

**开发者**: [你的名字]
**项目**: Lifespan Extension Project
**GitHub**: (待创建)
**Email**: (待添加)

---

**下次更新**: Phase 1 完成后 (2026-03-18)

**保持更新频率**: 每个重要里程碑后更新
