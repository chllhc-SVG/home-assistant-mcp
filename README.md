# Home Assistant MCP Control

一个用于控制外部 Home Assistant 设备的 MCP 控制层与前端系统页面。

## 当前架构

- Home Assistant 不在本仓库内启动
- 本仓库只负责 MCP 控制层与前端系统页面
- 通过根目录 `.env` 连接你自己的 Home Assistant 地址与 Token

## 快速启动

### 1. 准备环境文件
复制 `.env.example` 为 `.env`，并填写你的 Home Assistant 地址与 token。

```env
HOME_ASSISTANT_BASE_URL=http://192.168.150.11:8123
HOME_ASSISTANT_TOKEN=your_home_assistant_long_lived_token
HOME_ASSISTANT_TIMEOUT_MS=15000
```

### 2. 一键启动

Windows 下直接运行：

```bash
pnpm docker:dev
```

它会自动：

- 检查 `.env`
- 构建并启动 Docker 服务
- 打印访问地址
- 尝试自动打开浏览器

如果你只想后台启动容器，也可以使用：

```bash
docker compose up -d
```

### 3. 访问地址

- 系统页面: http://127.0.0.1:5173
- MCP API: http://127.0.0.1:4000/healthz
- 设备控制 API: http://127.0.0.1:4000/api/control/lights

## 常用命令

```bash
pnpm docker:dev
docker compose up -d --build
docker compose up -d
docker compose ps
docker compose logs -f mcp-server
docker compose logs -f log-platform
docker compose down
```

## 目录说明

- `packages/mcp-server`：MCP 控制层后端
- `apps/log-platform`：前端系统页面
- `config/lights.json`：可控制设备白名单
- `start.bat` / `start.ps1`：Windows 一键启动脚本
