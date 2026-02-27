# 🔧 快速修复说明 - 已修复的问题

## ✅ 已修复的3个问题

### 1. Sync API 404 错误 ✅
**问题**: Windows Collector 调用 `/api/v1/sync`，但后端是 `/api/v1/sync/events`

**修复**:
```rust
// apps/desktop/src-tauri/src/sync/client.rs:285
let url = format!("{}/api/v1/sync/events", ...);
```

### 2. JWT Token 未显示在 Web Dashboard ✅
**问题**: 后端返回 `access_token`，但前端期望 `token`

**修复**:
```typescript
// packages/web/src/lib/api.ts
login().then(response => ({
  token: response.access_token,  // 字段映射
  user: { ... }
}))
```

### 3. Windows Collector 默认配置 ✅
**新增功能**:
- 默认服务器地址: `http://localhost:3000`
- 自动加载已保存配置
- 只需输入 JWT Token
- Device ID 可选（留空自动生成）

---

## 🚀 快速测试流程

### Step 1: 重启应用（必须）

**Web Dashboard**:
```bash
cd packages/web
npm run dev
```

**Windows Collector**:
```bash
cd apps/desktop
npm run tauri:dev
```

### Step 2: 获取 JWT Token（超简单！）

1. 打开浏览器 → http://localhost:5173
2. 登录: `test@lifespan.local` / `TestPass123!`
3. 点击 **Settings** (左侧菜单)
4. 找到 "**JWT Token (for Windows Collector)**"
5. 点击 **Copy** 按钮
6. ✅ 看到 "Copied!"

### Step 3: 配置 Windows Collector

1. Windows Collector 窗口 → **Settings** 按钮
2. 只需填写:
   - **JWT Token**: Ctrl+V 粘贴（从 Web Dashboard 复制的）
   - Server URL: 已预填 `http://localhost:3000`
   - Device ID: 留空（自动生成）
3. 点击 **Save Configuration**

### Step 4: 测试同步

1. **Start Tracking**
2. 切换几个应用（Chrome, VSCode, 记事本等）
3. 等待 30 秒
4. **Sync Now**
5. ✅ 看到状态变为 "Synced"

---

## 📋 预期结果

### Web Dashboard Settings 页面
```
✅ Email: test@lifespan.local (disabled)
✅ Name: [可编辑]
✅ JWT Token: eyJhbGcOiJIUzI1NiIsInR5cCI6IkpXVCJ9... [Copy按钮]
```

### Windows Collector Settings
```
✅ Server URL: http://localhost:3000 [预填]
✅ JWT Token: [只粘贴这里]
✅ Device ID: [留空自动生成]
```

### 同步状态
```
✅ Status: Synced
✅ Last Sync: just now
✅ Pending Events: 0
```

---

## 🐛 如果还有问题

### 问题 1: Token 仍然不显示
```bash
# 清除浏览器 localStorage
1. F12 → DevTools
2. Application → Local Storage
3. 删除所有项
4. 刷新页面
5. 重新登录
```

### 问题 2: 同步仍然 404
```bash
# 确认 Windows Collector 已重新编译
cd apps/desktop
npm run tauri:dev
# 应该看到 "Compiling..." 消息
```

### 问题 3: 登录后 Token 为空
```bash
# 检查后端响应
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@lifespan.local","password":"TestPass123!"}'
# 应该看到 "access_token" 字段
```

---

## ✅ 测试检查清单

- [ ] Web Dashboard 登录成功
- [ ] Settings 页面显示 JWT Token
- [ ] Copy 按钮点击后变为 "Copied!"
- [ ] Windows Collector 预填服务器地址
- [ ] Windows Collector 加载已保存配置
- [ ] 粘贴 Token 后保存成功
- [ ] 同步状态显示 "Synced"
- [ ] 数据库有新事件记录

---

**准备就绪！现在测试应该非常简单了！** 🎉

只需要：
1. Web Dashboard → Settings → Copy Token
2. Windows Collector → Settings → 粘贴 Token → Save
3. Start Tracking → Sync Now ✅

完成！
