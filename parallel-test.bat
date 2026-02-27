@echo off
REM Lifespan - 并行测试启动脚本
REM 同时启动 Web Dashboard 和 Windows Collector

echo ========================================
echo Lifespan - 并行测试环境
echo ========================================
echo.

REM 检查后端服务器
echo [检查] 后端 API 服务器...
curl -s http://localhost:3000/health >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 后端服务器未运行！
    echo.
    echo 请先在新终端启动后端：
    echo   cd packages/api
    echo   npm run dev
    echo.
    pause
    exit /b 1
) else (
    echo ✅ 后端服务器运行中 (port 3000)
)

echo.
echo ========================================
echo 选择测试模式:
echo ========================================
echo.
echo 1. 启动 Web Dashboard (端口 5173)
echo 2. 启动 Windows Collector (Tauri)
echo 3. 同时启动两者
echo 4. 退出
echo.

set /p choice="请选择 (1-4): "

if "%choice%"=="1" goto web
if "%choice%"=="2" goto desktop
if "%choice%"=="3" goto both
if "%choice%"=="4" goto end

:web
echo.
echo [启动] Web Dashboard...
echo.
cd packages/web
start "Lifespan Web Dashboard" cmd /k "npm run dev"
echo ✅ Web Dashboard 已在后台启动
echo 🌐 访问: http://localhost:5173
goto end

:desktop
echo.
echo [启动] Windows Collector...
echo.
cd apps/desktop
start "Lifespan Windows Collector" cmd /k "npm run tauri:dev"
echo ✅ Windows Collector 已在后台启动
goto end

:both
echo.
echo [启动] Web Dashboard 和 Windows Collector...
echo.
start "Lifespan Web Dashboard" cmd /c "cd packages/web && npm run dev && pause"
timeout /t 3 >nul
start "Lifespan Windows Collector" cmd /c "cd apps/desktop && npm run tauri:dev && pause"
echo.
echo ✅ 两个应用已启动！
echo.
echo 📱 测试环境:
echo    Web Dashboard: http://localhost:5173
echo    Windows Collector: 桌面应用窗口
echo.
goto end

:end
echo.
echo ========================================
echo 测试提示:
echo ========================================
echo.
echo 1. Web Dashboard (http://localhost:5173)
echo    - 登录: test@lifespan.local / TestPass123!
echo    - 测试设置页面
echo    - 测试黑暗模式
echo.
echo 2. Windows Collector
echo    - 配置服务器 (http://localhost:3000)
echo    - 设置 JWT Token
echo    - 启动数据采集
echo    - 同步数据
echo.
echo 3. 验证同步
echo    - 在 Web Dashboard 查看数据
echo    - 在数据库查询 events 表
echo.
echo 详细测试指南: TESTING-GUIDE.md
echo ========================================
echo.
pause
