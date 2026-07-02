# Home Assistant MCP Control

一个用于控制外部 Home Assistant 设备的 MCP 控制层与前端系统页面。

## 当前架构

- Home Assistant 不在本仓库内启动
- 本仓库只负责 MCP 控制层与前端系统页面
- 通过根目录 `.env` 连接你自己的 Home Assistant 地址与 Token
- 控制链路分为：启动装配层、配置与设备映射层、策略与 Schema 校验层、工具层、Home Assistant 访问层、HTTP 对外服务层、审计与记录层

## 快速启动

### 1. 准备环境文件
复制 `.env.example` 为 `.env`，并填写你的 Home Assistant 地址与 token。

```env
HOME_ASSISTANT_BASE_URL=http://192.168.150.11:8123
HOME_ASSISTANT_TOKEN=your_home_assistant_long_lived_token
HOME_ASSISTANT_TIMEOUT_MS=15000
```

### 2. 一键启动

直接运行：

```bash
pnpm start
```

或者：

```bash
pnpm docker:dev
```

它会自动：

- 检查 `.env`
- 构建并启动 Docker 服务
- 打印访问地址
- 尝试自动打开浏览器

这个命令已改为跨平台脚本，可在 Windows、macOS 和 Linux 上直接使用，不再依赖 `cmd /c start.bat`。

如果你只想后台启动容器，也可以使用：

```bash
docker compose up -d
```

### 3. 访问地址

- 系统页面: http://127.0.0.1:5173
- MCP API: http://127.0.0.1:4000/healthz
- 设备列表 API: http://127.0.0.1:4000/api/admin/devices
- 设备发现 API: http://127.0.0.1:4000/api/admin/ha/entities/discover

## 当前支持的设备域

- `light`：开关、亮度、状态查询
- `switch`：开关、状态查询
- `button`：按下、状态查询
- `number`：数值设置、状态查询
- `climate`：温度、HVAC 模式、风扇模式、摆风模式、状态查询
- `sensor`：状态查询

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
- `config/lights.json`：可控制设备白名单，历史命名保留，内容已支持多设备域
- `start.bat` / `start.ps1`：本地一键启动脚本，内部已切换为跨平台逻辑
