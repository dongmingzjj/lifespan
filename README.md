# 人类寿命延长计划 (Lifespan Extension Project)

> 通过 AI 和记忆系统，将人类从重复性劳动中解放，让生命时间用于创造和体验。

**状态**: 🚧 初始化阶段
**开始时间**: 2026-02-25

---

## 项目愿景

**核心价值主张**: 每天为你节省 2 小时 = 每年延长 30 天生命

---

## 核心功能

1. **行为数据采集** - 自动追踪用户在设备上的所有行为
2. **行为时间线** - 可视化展示时间使用情况
3. **AI 行为蒸馏** - 从时间线提取用户画像和模式
4. **行为分析** - AI 驱动的工作模式识别和生产力建议 ✨ New
5. **记忆系统** - 三层记忆（工作/短期/长期）
6. **AI 助理** - 像真人助理一样理解和执行任务

---

## 技术栈

- **后端**: Node.js + TypeScript
- **AI**: 智谱 AI (zhipu code plan)
- **数据库**: PostgreSQL + Vector DB (pgvector)
- **缓存**: Redis
- **前端**: React + TypeScript
- **桌面端**: Tauri (跨平台 Windows/Android)
- **自托管**: N100 服务器 (4G/64G)

---

## 快速开始

### 前置要求

- Node.js 18+
- Rust 1.70+ (用于 Tauri)
- Android Studio (用于 Android 开发)
- Docker (用于本地服务器)
- 智谱 AI API Key

### 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器
npm run dev

# 3. 启动桌面应用
npm run dev:desktop

# 4. 启动 Web 界面
npm run dev:web
```

---

## 隐私策略

**混合模式**:
- ✅ 敏感数据本地加密存储
- ✅ 分析数据脱敏后同步
- ✅ 用户完全控制数据权限
- ✅ 可随时删除历史数据

---

**开发者**: [Your Name]
**开始时间**: 2026-02-25
