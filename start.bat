@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d %~dp0

echo [启动] 正在检查环境配置...
if not exist .env (
  if exist .env.example (
    copy /Y .env.example .env >nul
    echo [提示] 已从 .env.example 生成 .env，请先填写 Home Assistant 地址和 Token 后再重新运行。
    start "" "https://github.com/chllhc-SVG/home-assistant-mcp#readme"
    exit /b 0
  )
  echo [错误] 缺少 .env 文件，请先创建后再启动。
  exit /b 1
)

echo [启动] 正在构建并启动 Docker 服务...
docker compose up -d --build
if errorlevel 1 (
  echo [错误] Docker 启动失败，请检查 Docker Desktop 是否已运行。
  exit /b 1
)

echo.
echo [完成] 系统页面： http://127.0.0.1:5173
echo [完成] MCP 接口： http://127.0.0.1:4000/healthz
echo [完成] 正在尝试自动打开浏览器...
start "" "http://127.0.0.1:5173"
