# Home Assistant MCP 控制层设计文档 v1.1

## 1. 文档概述

### 1.1 文档目的

本文档定义当前仓库的真实实现：**通过 MCP 控制层连接外部 Home Assistant，并由本地 Docker 启动前端系统页面与 API 服务**。本文档用于统一说明：

- 当前系统目标
- 实际部署形态
- MCP 工具分类
- Home Assistant 设备控制边界
- Docker 一键启动方式
- 日志与安全约束
- 未来扩展方向

### 1.2 当前实现范围

当前阶段实现的是“**外部 Home Assistant + 本地 MCP 控制层 + 本地系统页面**”，具体包括：

- 查询可控设备列表
- 解析设备名称与别名
- 查询设备状态
- 打开/关闭 `light.*` 与 `switch.*` 设备
- 控制 `light.*` 设备亮度
- 记录审计日志
- 本地 Docker 一键启动

### 1.3 非目标范围

当前阶段不包含：

- 在本仓库中启动 Home Assistant 本体
- 通用 Home Assistant 服务透传
- 空调、风扇、门锁、场景联动等非当前白名单设备
- 自动化规则编排

---

## 2. 设计目标与原则

### 2.1 设计目标

1. **外部 Home Assistant 接入**  
   通过 `.env` 指定外部 Home Assistant 的地址与 token。

2. **Docker 化部署**  
   本地只需 `pnpm docker:dev` 即可启动后端与前端页面。

3. **能力收敛**  
   仅开放白名单设备与明确工具，不开放任意 API 代理。

4. **可维护与可交接**  
   工具、配置、前端、Docker 启动脚本职责清晰。

5. **可追踪**  
   所有操作记录审计日志，支持回查。

### 2.2 设计原则

- 职责单一
- 以配置驱动设备白名单
- 模型只能调用公开工具
- 控制后进行状态回读
- 默认不触碰本地 Home Assistant 容器

---

## 3. 当前架构

```mermaid
flowchart LR
    U[用户 / 前端系统页面] --> FE[前端系统页面]
    FE --> API[MCP 控制层 API]
    API --> REG[设备白名单 / 目录]
    API --> POL[策略校验]
    API --> HA[Home Assistant REST API]
    HA --> EXT[外部 Home Assistant]
    API --> LOG[审计日志]
```

### 3.1 架构说明

- **前端系统页面** 负责展示设备、日志和控制入口
- **MCP 控制层 API** 负责设备解析、权限、控制与日志
- **外部 Home Assistant** 负责真实设备执行
- **本地 Docker** 只启动 MCP 层与系统页面，不启动 Home Assistant 本体

---

## 4. MCP 工具分类

当前工具按照职责分为三类：

### 4.1 设备发现类

- `list_lights`：列出可控设备
- `resolve_light`：按别名或关键字解析设备

### 4.2 设备状态类

- `get_light_state`：查询设备当前状态

### 4.3 设备控制类

- `turn_on_light`：打开设备
- `turn_off_light`：关闭设备
- `set_light_brightness`：设置亮度
- `set_light_state`：统一设置开关状态与亮度

### 4.4 工具层实现位置

- 工具入口：`packages/mcp-server/src/tools/index.ts`
- 灯光工具：`packages/mcp-server/src/tools/lights.ts`
- 公共工具方法：`packages/mcp-server/src/tools/shared.ts`

---

## 5. 设备抽象模型

当前设备白名单同时支持 `light` 与 `switch`：

```json
{
  "device_id": "switch_xiaomi_w2_8263_left_switch_service",
  "display_name": "开关左键",
  "aliases": ["左键", "开关左键"],
  "entity_id": "switch.xiaomi_w2_8263_left_switch_service",
  "domain": "switch",
  "room": "5f_lounge",
  "type": "switch",
  "supports_brightness": false,
  "capabilities": ["turn_on", "turn_off", "get_state"],
  "risk_level": "low",
  "enabled": true
}
```

`light.*` 设备可以支持亮度；`switch.*` 设备仅支持开关与状态查询。

---

## 6. Docker 启动方式

### 6.1 一键启动

```bash
pnpm docker:dev
```

该命令会：

- 检查 `.env`
- 启动 Docker Compose
- 构建 MCP 后端与前端页面
- 打印访问地址
- 尝试自动打开浏览器

### 6.2 访问地址

- 系统页面：`http://127.0.0.1:5173`
- MCP API：`http://127.0.0.1:4000/healthz`
- 设备控制 API：`http://127.0.0.1:4000/api/control/lights`

### 6.3 环境变量

示例 `.env`：

```env
HOME_ASSISTANT_BASE_URL=http://192.168.150.11:8123
HOME_ASSISTANT_TOKEN=your_home_assistant_long_lived_token
HOME_ASSISTANT_TIMEOUT_MS=15000
```

---

## 7. 目录结构

- `apps/log-platform`：前端系统页面
- `packages/mcp-server`：MCP 控制层后端
- `config/lights.json`：设备白名单
- `start.bat` / `start.ps1`：一键启动脚本
- `docker-compose.yml`：Docker 编排文件

---

## 8. 安全与边界

- 不在前端暴露 Home Assistant token
- 不启动本地 Home Assistant 本体
- 只允许设备白名单内的实体被控制
- 所有控制动作写入审计日志
- 亮度仅对支持亮度的 `light` 设备开放

---

## 9. 后续扩展方向

未来可在当前模式基础上继续扩展：

- `climate`
- `fan`
- `scene`
- `cover`

扩展方式建议保持：

- 新增分类文件
- 新增对应工具模块
- 不破坏现有灯光与开关工具接口

| 字段 | 类型 | 说明 |
|---|---|---|
| `device_id` | string | 系统内部唯一设备 ID |
| `display_name` | string | 标准展示名称 |
| `aliases` | string[] | 别名列表 |
| `entity_id` | string | Home Assistant 实体 ID |
| `domain` | string | 固定为 `light` |
| `room` | string | 所属房间 |
| `type` | string | 设备类型 |
| `supports_brightness` | boolean | 是否支持亮度调节 |
| `capabilities` | string[] | 设备支持的动作能力 |
| `risk_level` | enum | 低/中/高风险 |
| `enabled` | boolean | 是否启用 |

---

## 8. MCP 工具接口正式规范

### 8.1 通用返回结构

#### 成功返回

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

#### 失败返回

```json
{
  "success": false,
  "data": null,
  "error": {
    "error_code": "DEVICE_NOT_FOUND",
    "message": "未找到匹配设备",
    "details": {}
  }
}
```

### 8.2 工具总览

本版本正式定义以下 MCP 工具：

1. `list_lights`
2. `resolve_light`
3. `get_light_state`
4. `turn_on_light`
5. `turn_off_light`
6. `set_light_brightness`
7. `set_light_state`

---

## 9. 工具接口定义

### 9.1 `list_lights`

#### 功能
列出可用灯光设备。

#### 输入参数
- `room`：可选，房间过滤
- `keyword`：可选，关键字过滤
- `support_brightness`：可选，仅返回支持亮度的灯

### 9.2 `resolve_light`

#### 功能
将自然语言名称解析为目标灯光设备。

### 9.3 `get_light_state`

#### 功能
查询指定灯光实体状态。

### 9.4 `turn_on_light`

#### 功能
打开灯光。

### 9.5 `turn_off_light`

#### 功能
关闭灯光。

### 9.6 `set_light_brightness`

#### 功能
设置灯光亮度。

### 9.7 `set_light_state`

#### 功能
同时设置灯光开关状态和亮度。

---

## 10. Home Assistant 对接规范

### 10.1 认证方式

MCP Server 访问 Home Assistant 时必须使用长期访问令牌。

### 10.2 核心接口

- `GET /api/states/{entity_id}`
- `POST /api/services/light/turn_on`
- `POST /api/services/light/turn_off`

---

## 11. 意图映射规范

### 11.1 支持的用户意图

| 用户表达 | 标准意图 |
|---|---|
| 打开灯 | `turn_on` |
| 关闭灯 | `turn_off` |
| 灯开着吗 | `get_state` |
| 调亮一点 | `set_brightness` |
| 调暗一点 | `set_brightness` |
| 调到 50% | `set_brightness` |
| 打开并调亮 | `set_light_state` |

---

## 12. 设备能力与约束策略

### 12.1 亮度能力判断

执行亮度相关动作前，必须确认：

- `supports_brightness == true`
- 或对应 Home Assistant 实体属性支持亮度

### 12.2 无亮度能力处理

若设备不支持亮度，必须返回明确错误：

```json
{
  "success": false,
  "data": null,
  "error": {
    "error_code": "BRIGHTNESS_NOT_SUPPORTED",
    "message": "该灯光设备不支持亮度调节",
    "details": {
      "entity_id": "light.xxx"
    }
  }
}
```

### 12.3 越界处理

亮度不合法时必须拒绝执行，不允许自动修正。

---

## 13. 错误码规范

### 13.1 错误码全集

| 错误码 | 说明 |
|---|---|
| `DEVICE_NOT_FOUND` | 未找到设备 |
| `DEVICE_AMBIGUOUS` | 设备存在歧义 |
| `DEVICE_UNAVAILABLE` | 设备不可用 |
| `INVALID_ARGUMENT` | 参数错误 |
| `BRIGHTNESS_NOT_SUPPORTED` | 设备不支持亮度 |
| `BRIGHTNESS_OUT_OF_RANGE` | 亮度越界 |
| `AUTH_FAILED` | Home Assistant 认证失败 |
| `TIMEOUT` | 请求超时 |
| `SERVICE_FAILED` | Home Assistant 服务失败 |
| `POLICY_DENIED` | 策略拒绝 |

---

## 14. 安全与权限设计

### 14.1 令牌管理

Home Assistant 令牌必须：

- 仅保存在服务端
- 通过环境变量或密钥系统管理
- 不写入前端
- 不写入日志
- 不提交仓库

---

## 15. 审计与可追踪性设计

### 15.1 日志目标

所有灯光控制请求都必须记录，方便：

- 调试
- 排障
- 审计
- 交接
- 追责
- 问题回溯

### 15.2 审计日志建议字段

```json
{
  "request_id": "req_20260630_0001",
  "timestamp": "2026-06-30T10:00:00Z",
  "user_input": "把客厅灯调到 50%",
  "intent": "set_brightness",
  "resolved_device": {
    "display_name": "客厅灯",
    "entity_id": "light.living_room_main"
  },
  "tool_name": "set_light_brightness",
  "tool_args": {
    "entity_id": "light.living_room_main",
    "brightness": 128
  },
  "result": {
    "success": true,
    "state_after": "on",
    "brightness_after": 128
  }
}
```

### 15.3 日志平台需求

前端日志平台需要支持：

- 按时间范围查询
- 按设备名称查询
- 按房间查询
- 按用户查询
- 按成功/失败状态查询
- 查看单条日志详情
- 查看控制链路时间线
- 查看请求参数、结果与错误码

---

## 16. 前端日志平台设计

### 16.1 平台定位

前端日志平台是企业内部可视化运维与审计页面，不参与设备控制，只负责展示与查询。

### 16.2 页面能力

建议至少包含以下页面：

1. **控制总览页**
2. **日志查询页**
3. **日志详情页**
4. **设备目录页**

### 16.3 前端技术栈

建议采用：

- React + TypeScript
- Vite
- Ant Design
- ECharts 或同类图表库
- React Router
- React Query 或 TanStack Query

### 16.4 前后端接口建议

前端日志平台通过独立的管理 API 读取数据，建议接口包括：

- `GET /api/admin/logs`
- `GET /api/admin/logs/:id`
- `GET /api/admin/devices`
- `GET /api/admin/stats/overview`
- `GET /api/admin/stats/errors`

### 16.5 运行版接口联动说明

当前已实现前后端联动的最小可运行版本：

- MCP Server 提供管理 API：
  - `GET /healthz`
  - `GET /api/admin/stats/overview`
  - `GET /api/admin/stats/errors`
  - `GET /api/admin/logs`
  - `GET /api/admin/logs/:id`
  - `GET /api/admin/devices`
- 前端日志平台通过 `VITE_ADMIN_API_BASE_URL` 访问管理 API
- 前端页面默认回退到本地示例数据，若 API 可访问则优先展示真实数据
- 数据查询采用统一响应包裹格式，便于后续替换为数据库实现

---

## 17. 工程实现规范

### 17.1 分层原则

建议采用以下分层：

1. Tool 层
2. Service 层
3. Adapter 层
4. Registry 层
5. Policy 层
6. Audit 层
7. Admin API 层

### 17.2 禁止事项

- 禁止在工具层直接写请求 Home Assistant 的逻辑
- 禁止在业务逻辑中硬编码设备实体
- 禁止将 token 写入代码
- 禁止绕过策略直接调用 API
- 禁止前端直接访问 Home Assistant

### 17.3 技术栈基线

本方案正式采用以下技术栈：

- **MCP Server**：TypeScript + Node.js
- **前端日志平台**：React + TypeScript + Vite
- **UI 组件库**：Ant Design
- **图表组件**：ECharts 或 Recharts
- **接口校验**：zod
- **日志服务**：结构化 JSON 日志

### 17.4 前端日志平台定位

前端日志平台用于查看和管理 MCP 控制链路的审计信息，核心能力包括：

- 控制请求列表查询
- 单条日志详情查看
- 按设备、时间、结果、工具名过滤
- 控制成功率和错误趋势概览
- 最近操作记录与异常告警展示
- 设备目录只读查看

该平台仅作为运维与审计平台，不承载设备控制指令本身。

---

## 18. 推荐目录结构

```text
home-assistant-mcp-light/
├─ apps/
│  ├─ mcp-server/
│  └─ log-platform/
├─ packages/
│  ├─ shared-types/
│  ├─ shared-schema/
│  └─ shared-utils/
├─ config/
│  └─ lights.json
├─ .env.example
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ package.json
```

### 18.1 当前落地代码骨架

当前已在工作区中创建以下 TS 骨架目录与文件：

- `packages/mcp-server`
- `apps/log-platform`
- `packages/shared-types`
- `packages/shared-utils`
- `packages/shared-schema`
- `config/lights.json`
- `.env.example`

其中 MCP Server 已包含：

- 灯光注册表
- Home Assistant 客户端封装
- 审计日志存储
- Zod 输入校验
- 灯光工具入口骨架
- 管理 API 服务

前端日志平台已包含：

- React + TypeScript + Vite 基础框架
- 总览页骨架
- 日志查询
- 详情抽屉
- 设备目录页
- 通过管理 API 的真实联动

---

## 19. 配置规范

### 19.1 环境变量

```bash
HOME_ASSISTANT_BASE_URL=http://192.168.150.11:8123
HOME_ASSISTANT_TOKEN=xxxxxxxxxxxxxxxx
HA_TOKEN=xxxxxxxxxxxxxxxx
HOME_ASSISTANT_TIMEOUT_MS=5000
MCP_SERVER_PORT=3000
ADMIN_WEB_PORT=4000
LOG_LEVEL=info
DATABASE_URL=postgresql://user:password@localhost:5432/ha_mcp
```

### 19.2 灯光配置示例

```json
{
  "lights": [
    {
      "device_id": "light_living_room_main",
      "display_name": "客厅灯",
      "aliases": ["客厅主灯", "沙发灯", "大灯"],
      "entity_id": "light.living_room_main",
      "domain": "light",
      "room": "living_room",
      "type": "light",
      "supports_brightness": true,
      "capabilities": ["turn_on", "turn_off", "set_brightness", "get_state"],
      "risk_level": "low",
      "enabled": true
    }
  ]
}
```

### 19.3 配置管理要求

- 配置文件与代码分离
- 设备变更优先改配置
- 环境差异通过环境变量区分
- 生产和测试环境必须隔离

---

## 20. API 与数据持久化建议

### 20.1 日志数据模型建议

建议将审计日志持久化到数据库，核心字段包括：

- `id`
- `request_id`
- `timestamp`
- `user_id`
- `user_input`
- `intent`
- `device_id`
- `entity_id`
- `tool_name`
- `tool_args`
- `ha_request`
- `ha_response`
- `result_status`
- `error_code`
- `duration_ms`

### 20.2 索引建议

建议建立以下索引：

- `timestamp`
- `request_id`
- `device_id`
- `entity_id`
- `result_status`
- `error_code`

### 20.3 日志查询分页

- 默认分页大小：20
- 最大分页大小：100
- 支持时间范围过滤
- 支持模糊查询关键字

---

## 21. 测试与验收要求

### 21.1 单元测试

应覆盖：

- 名称解析
- 亮度范围校验
- 无设备返回
- 多设备歧义
- 无亮度能力返回
- 错误码统一返回

### 21.2 集成测试

应覆盖：

- 调用 Home Assistant 成功
- 状态回读成功
- 设备离线异常
- Token 失效异常
- 超时异常

### 21.3 验收标准

系统必须满足以下验收条件：

1. 能通过自然语言控制至少一个灯
2. 能查询灯的状态
3. 能设置灯的亮度
4. 不能对不支持亮度的设备执行亮度操作
5. 所有请求有日志记录
6. 所有错误有标准错误码
7. 设备新增不需要改核心控制逻辑
8. 文档足够清晰，其他团队可以按文档接手实现
9. 前端日志平台可查询与展示控制链路

---

## 22. 扩展设计建议

### 22.1 未来扩展原则

未来扩展到插座、空调、风扇时，建议遵循：

1. 新增设备域工具，不破坏现有灯光工具
2. 公共结构复用
3. 错误码体系复用
4. 日志规范复用
5. 目录结构复用
6. 策略层复用
7. 前端日志平台复用管理 API 和展示范式

### 22.2 可扩展点

当前已预留扩展点：

- `room`
- `aliases`
- `capabilities`
- `risk_level`
- `enabled`
- `supports_brightness`

这些字段后续可以直接支持更多设备类型。

---

## 23. 最终推荐实施顺序

### 第一阶段：最小闭环
目标：先跑通一个灯的控制链路。

实现：

- `resolve_light`
- `get_light_state`
- `turn_on_light`
- `turn_off_light`
- `set_light_brightness`

### 第二阶段：设备目录化
目标：完善别名、房间、能力、状态映射。

### 第三阶段：审计与策略
目标：完善日志、错误码、权限、验证。

### 第四阶段：前端日志平台
目标：上线日志查询、控制概览、设备目录查看。

### 第五阶段：体验优化
目标：支持“调亮一点”“调暗一点”“调到 70%”等语义。

### 第六阶段：横向扩展
目标：在保持接口风格一致的基础上扩展到更多设备域。

---

## 24. 控制功能最终实现说明

### 24.1 控制功能总入口图

```mermaid
flowchart TD
    WEB[前端日志与控制页面] --> ADMIN[Admin / Control API]
    LLM[大模型 / Agent] --> MCP[MCP Tool Registry]
    ADMIN --> MCP
    MCP --> SCHEMA[Zod 参数校验]
    MCP --> REG[LightRegistry 设备目录]
    MCP --> POL[PolicyEngine 策略校验]
    MCP --> HA[HaClient]
    HA --> HAAPI[Home Assistant REST API]
    HAAPI --> LIGHT[真实灯光实体]
    HA --> READBACK[状态回读]
    READBACK --> AUDIT[AuditStore 审计日志]
    AUDIT --> WEBLOG[前端日志表格 / 详情抽屉]
```

控制入口分为两类：

1. **大模型入口**：通过 MCP 工具直接调用 `turn_on_light`、`turn_off_light`、`set_light_brightness` 等工具。
2. **前端入口**：通过页面中的“具体设备控制”区域调用 Admin Control API，后端再复用同一套 MCP 工具实现。

这样可以保证前端控制、大模型控制、审计日志都使用同一套后端能力，不出现两套控制逻辑。

### 24.2 MCP 工具实现说明文档

MCP 工具位于：

```text
packages/mcp-server/src/tools/index.ts
```

核心工具如下：

| MCP 工具 | 功能 | 后端校验 | Home Assistant 操作 | 是否写日志 |
|---|---|---|---|---|
| `list_lights` | 查询灯光设备目录 | 过滤参数校验 | 不调用 HA | 否 |
| `resolve_light` | 解析自然语言灯光名称 | query 校验 | 不调用 HA | 否 |
| `get_light_state` | 查询灯光状态 | entity_id + 策略校验 | `GET /api/states/{entity_id}` | 当前仅查询 |
| `turn_on_light` | 打开灯光 | entity_id + 策略校验 | `POST /api/services/light/turn_on` | 是 |
| `turn_off_light` | 关闭灯光 | entity_id + 策略校验 | `POST /api/services/light/turn_off` | 是 |
| `set_light_brightness` | 设置亮度 | entity_id + 亮度范围 + 亮度能力校验 | `POST /api/services/light/turn_on` | 是 |
| `set_light_state` | 一次设置状态和亮度 | state + brightness 校验 | `turn_on` 或 `turn_off` | 是 |

工具执行流程：

1. 接收输入参数
2. 使用 `zod` schema 做结构校验
3. 使用 `LightRegistry` 查找设备
4. 使用 `PolicyEngine` 判断是否允许控制
5. 使用 `HaClient` 调用 Home Assistant
6. 控制后执行状态回读
7. 将控制结果写入 `AuditStore`
8. 前端通过 `/api/admin/logs` 查询展示日志

### 24.3 前端控制功能说明

前端控制页面位于：

```text
apps/log-platform/src/pages/DashboardPage.tsx
```

前端现在提供以下控制能力：

- 选择具体灯光设备
- 查看设备 `entity_id`、房间、亮度能力
- 开灯
- 关灯
- 设置亮度
- 查询当前状态
- 控制完成后自动刷新审计日志
- 点击日志行查看详情抽屉
- 查看 Home Assistant 控制映射表

前端 API 封装位于：

```text
apps/log-platform/src/api/client.ts
```

### 24.4 Admin Control API

前端页面不直接访问 Home Assistant，而是访问后端 Control API。

| API | 方法 | 功能 | 对应 MCP 工具 |
|---|---|---|---|
| `/api/control/lights/:entityId/state` | GET | 查询状态 | `get_light_state` |
| `/api/control/lights/resolve` | POST | 解析设备 | `resolve_light` |
| `/api/control/lights/:entityId/turn-on` | POST | 开灯 | `turn_on_light` |
| `/api/control/lights/:entityId/turn-off` | POST | 关灯 | `turn_off_light` |
| `/api/control/lights/:entityId/brightness` | POST | 设置亮度 | `set_light_brightness` |
| `/api/control/lights/:entityId/state` | POST | 设置状态 | `set_light_state` |

### 24.5 Home Assistant 控制映射表

| 前端按钮 | Control API | MCP 工具 | Home Assistant 服务 | 请求体核心字段 |
|---|---|---|---|---|
| 开灯 | `POST /api/control/lights/:entityId/turn-on` | `turn_on_light` | `light.turn_on` | `entity_id` |
| 关灯 | `POST /api/control/lights/:entityId/turn-off` | `turn_off_light` | `light.turn_off` | `entity_id` |
| 设置亮度 | `POST /api/control/lights/:entityId/brightness` | `set_light_brightness` | `light.turn_on` | `entity_id`, `brightness` |
| 查询状态 | `GET /api/control/lights/:entityId/state` | `get_light_state` | `/api/states/{entity_id}` | URL path |
| 设置状态 | `POST /api/control/lights/:entityId/state` | `set_light_state` | `light.turn_on` / `light.turn_off` | `entity_id`, `state`, `brightness` |

### 24.6 具体设备配置位置

具体设备不写死在代码中，统一配置在：

```text
config/lights.json
```

新增或修改灯光设备时，只需要改这里：

```json
{
  "device_id": "light_living_room_main",
  "display_name": "客厅灯",
  "aliases": ["客厅主灯", "大灯", "沙发灯"],
  "entity_id": "light.living_room_main",
  "domain": "light",
  "room": "living_room",
  "type": "light",
  "supports_brightness": true,
  "capabilities": ["turn_on", "turn_off", "set_brightness", "get_state"],
  "risk_level": "low",
  "enabled": true
}
```

其中最重要的是 `entity_id`，必须与 Home Assistant 中真实实体一致。

---

## 25. 最终结论

本方案采用“大模型 + MCP Server + Home Assistant”的企业级标准链路，当前聚焦灯光控制，是因为：

- 范围最清晰
- 闭环最容易验证
- 复杂度最低
- 最适合做成稳定的企业基线能力

### 最终建议

- **大模型**：只负责理解用户意图
- **MCP Server**：负责设备解析、权限控制、工具暴露、审计、错误码
- **Home Assistant**：负责执行实际控制
- **设备目录**：负责统一设备抽象与别名映射
- **前端日志平台**：负责控制链路可视化、审计、查询与运维支持
- **TypeScript workspace**：负责统一后端、前端和共享类型的工程约束

### 交接建议

为了便于其他部门接手，建议将本方案配套以下交付物一起沉淀：

1. 接口文档
2. JSON Schema
3. 设备目录模板
4. 错误码字典
5. 日志字段说明
6. 配置文件模板
7. 测试用例清单
8. 部署说明
9. 前端日志平台原型与接口说明

本方案可直接作为研发实现、联调测试和后续交接的正式基线文档。
