# 企业级大模型通过 MCP 控制 Home Assistant 灯光的正式设计方案 v1.0

## 1. 文档概述

### 1.1 文档目的

本文档用于定义“**大模型通过 MCP 控制 Home Assistant 灯光**”的企业级实现方案，明确系统目标、架构边界、MCP 工具接口、数据结构、异常处理、日志审计、安全控制和后续扩展策略。

本文档的定位是：

- 作为产品、研发、测试、运维的统一设计依据
- 作为 MCP Server 开发的正式接口约束
- 作为 Home Assistant 对接实现的开发基线
- 作为后续其他部门接手时的标准化交付文档
- 作为 TypeScript 版 MCP Server 与前端日志平台的实现基线

### 1.2 当前范围

当前阶段仅实现以下灯光控制能力：

- 查询灯光列表
- 解析灯光名称
- 查询灯光状态
- 打开灯光
- 关闭灯光
- 设置灯光亮度
- 同时设置灯光开关与亮度

### 1.3 非目标范围

本阶段明确不包含：

- 空调控制
- 风扇控制
- 插座控制
- 门锁控制
- 场景联动
- 自动化规则
- 多设备编排
- 任意 Home Assistant 服务透传

---

## 2. 设计目标与原则

### 2.1 设计目标

本方案的目标是建立一条标准化、低耦合、可审计、可扩展的控制链路，使用户可以通过自然语言指令控制 Home Assistant 中的灯光设备。

核心目标如下：

1. **链路清晰**  
   大模型只负责理解意图，MCP Server 负责能力控制，Home Assistant 负责设备执行。

2. **接口标准化**  
   所有灯光能力通过固定 MCP 工具暴露，避免模型直接接触底层实体协议。

3. **企业可维护**  
   设备目录、能力约束、权限策略、日志审计全部配置化和模块化。

4. **后续易扩展**  
   后续可平滑扩展到插座、空调、风扇、场景，不破坏当前接口设计。

5. **安全可控**  
   令牌不下发前端，动作受限于白名单和设备能力，所有操作可追踪。

### 2.2 设计原则

#### 原则一：职责单一
每一层只做自己的事情：

- 大模型：理解意图
- MCP Server：暴露能力、校验、编排、审计
- Home Assistant：执行控制
- 设备层：物理响应

#### 原则二：能力收敛
MCP 不做任意 API 代理，不开放不受控的通用调用入口。

#### 原则三：模型不可越权
模型只能调用公开工具，不能直接访问 token、配置、底层网络资源。

#### 原则四：配置优先
设备信息、别名、支持能力、风险等级全部走配置，不硬编码。

#### 原则五：结果闭环
每次控制建议进行状态回读，确保实际状态与预期一致。

---

## 3. 业务边界与术语定义

### 3.1 业务边界

本系统只处理灯光相关能力，灯光是当前唯一设备域。

系统控制对象统一映射到 Home Assistant 的 `light` 域实体。

### 3.2 关键术语

| 术语 | 定义 |
|---|---|
| 大模型 | 用于自然语言理解和工具调用决策的 LLM/Agent |
| MCP Server | 通过 MCP 协议向大模型提供结构化工具能力的服务 |
| Home Assistant | 智能家居中枢，负责设备接入和控制 |
| 实体 `entity_id` | Home Assistant 中设备的唯一标识，如 `light.living_room_main` |
| 设备目录 | 存储灯光设备别名、实体 ID、能力、房间等信息的配置或数据库 |
| 亮度 | 灯光亮度值，统一采用 `0~255` 标准 |
| 状态回读 | 控制执行后再次读取实体状态，验证实际结果 |

---

## 4. 总体架构

### 4.1 架构图

```mermaid
flowchart LR
    U[用户自然语言] --> LLM[大模型 / Agent]
    LLM --> MCP[MCP Server]
    MCP --> REG[设备目录 / 别名映射]
    MCP --> POL[策略与权限控制]
    MCP --> HA[Home Assistant API 适配器]
    HA --> HASS[Home Assistant]
    HASS --> LIGHT[灯光设备]
    MCP --> LOG[审计日志 / 追踪日志]
```

### 4.2 架构说明

#### 用户层
用户通过聊天窗口、语音助手、App 或网页输入自然语言，例如：

- 打开客厅灯
- 关闭卧室灯
- 把餐厅灯调亮一点
- 现在灯开着吗

#### 大模型层
大模型负责：

- 识别用户意图
- 识别灯光名称、别名、房间
- 判断是否需要查询状态
- 判断是否需要设置亮度
- 调用对应 MCP 工具

#### MCP Server 层
MCP Server 负责：

- 暴露标准灯光能力
- 解析设备名称和别名
- 校验参数和能力
- 调用 Home Assistant API
- 做状态回读
- 统一错误码
- 记录审计日志

#### Home Assistant 层
Home Assistant 负责：

- 管理灯光实体
- 提供状态查询
- 执行开关和亮度控制
- 维护状态一致性

---

## 5. 企业级设计要求

### 5.1 可交接性

为保证后续其他团队可顺利接手，本方案必须满足：

1. 接口文档完整
2. 数据结构明确
3. 错误码统一
4. 配置与代码分离
5. 日志可追踪
6. 目录结构标准化
7. 扩展方式明确
8. 默认行为一致

### 5.2 可维护性

- 新增灯光不改核心逻辑，只改设备目录
- 设备能力差异通过 capability 字段控制
- 工具输入输出统一规范
- 业务异常可读且可定位
- 逻辑分层清晰，避免耦合

### 5.3 扩展性

当前为灯光域，但设计需支持未来扩展到：

- `switch`
- `climate`
- `fan`
- `scene`

扩展时应复用公共结构、错误码、日志、配置方式，不破坏当前接口风格。

---

## 6. 灯光控制能力定义

### 6.1 当前支持能力

- `list_lights`
- `resolve_light`
- `get_light_state`
- `turn_on_light`
- `turn_off_light`
- `set_light_brightness`
- `set_light_state`

### 6.2 能力说明

#### 查询列表
列出当前可控制的灯光设备，支持按房间、关键字、亮度能力过滤。

#### 名称解析
根据用户自然语言中的“客厅灯、主卧灯、沙发灯”等别名映射到具体实体。

#### 状态查询
返回灯光当前状态，包括 `on/off/unavailable/unknown`，并可返回亮度值。

#### 开关控制
通过 Home Assistant 标准 `light.turn_on` 和 `light.turn_off` 控制。

#### 亮度控制
统一采用 `0~255` 范围，若设备不支持亮度，必须明确拒绝。

#### 统一状态设置
允许一次性设置开关和亮度，适用于“打开并调到 80%”这类场景。

---

## 7. 统一设备抽象模型

### 7.1 设备对象定义

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

### 7.2 字段规范

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
