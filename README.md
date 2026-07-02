# Home Assistant MCP Control

一个用于控制外部 Home Assistant 设备的 MCP 控制层与前端系统页面。

## 项目定位

本仓库不是 Home Assistant 本体，也不是通用的自动化平台，而是一个**围绕你自己的 Home Assistant 实例**构建的控制与观测层。它的目标是把“设备发现、能力映射、MCP 工具暴露、审计日志、前端管理页面”串成一条稳定链路，方便大模型、前端页面和人工运维统一调用。

## 架构总览

整体架构按职责拆分为七层，彼此之间尽量保持单向依赖：

### 1. 启动装配层

负责进程启动、环境变量加载、运行模式选择和服务编排。

- 入口位于 `packages/mcp-server/src/main.ts`
- 支持 `stdio` 与 `http` 两种 MCP 运行模式
- 负责同时启动：
  - 管理 API（默认 `4000`）
  - MCP HTTP 服务（默认 `4010`）
- 负责把 runtime、工具集合、设备注册表、Home Assistant 客户端装配到 HTTP 或 stdio 入口中

### 2. 配置与设备映射层

负责把静态配置和 Home Assistant 动态实体融合成可控制设备视图。

- 配置文件：`config/lights.json`
- 作用：维护可控设备白名单和历史命名映射
- 设备映射会结合 Home Assistant 实体信息、房间信息、能力信息生成统一的 `DeviceRecord`
- 这层的目标不是“直接控制设备”，而是产出稳定、适合上层使用的设备视图

### 3. Schema 与策略校验层

负责对外部输入做结构化约束、字段校验和动作合法性检查。

- 入口文件：`packages/mcp-server/src/models/schemas.ts`
- 使用 `zod` 对所有工具参数进行强校验
- 负责把自然语言解析后的参数，转换成可执行、可验证的结构化输入
- 典型职责包括：
  - `entity_id` 非空校验
  - 亮度范围归一化
  - `hvac_mode` 枚举限制
  - 数值型参数的有限性校验

### 4. 工具层

负责把 schema 校验后的输入转成具体控制逻辑。

- 入口文件：`packages/mcp-server/src/tools/*`
- 负责设备发现、状态查询、开关控制、亮度控制、数值控制、空调控制等
- 工具层面向的是“业务动作”，而不是 HTTP 或 MCP 协议

### 5. Home Assistant 访问层

负责与真实 Home Assistant 实例通信。

- 入口文件：`packages/mcp-server/src/services/ha-client.ts`
- 负责读取 Home Assistant 实体、查询状态、下发控制指令
- 处理鉴权、超时、错误转换、实体发现等能力
- 上层只看到统一错误格式，不直接处理底层 API 细节

### 6. 对外服务层

负责把同一套 runtime 暴露成 HTTP 管理 API 与 MCP 服务。

- HTTP 管理 API：`packages/mcp-server/src/server.ts`
- MCP JSON-RPC / HTTP：`packages/mcp-server/src/mcp-http.ts`
- stdio MCP：`packages/mcp-server/src/mcp.ts`

这层主要解决三件事：

- 给前端页面提供数据接口
- 给 MCP 客户端提供工具注册与调用接口
- 保证不同传输方式下工具定义一致

### 7. 审计与记录层

负责记录每次工具调用、失败信息与统计数据。

- 入口文件：`packages/mcp-server/src/services/audit-store.ts`
- 记录请求时间、工具名、设备名、结果状态、错误码、耗时等字段
- 前端的“日志查询”和“失败统计”均依赖这一层

---

## 运行时数据流

一次典型的控制请求大致会经过以下链路：

1. 前端或 MCP 客户端发起请求
2. 对外服务层接收请求
3. Schema 层校验参数
4. 工具层决定具体动作
5. Home Assistant 访问层执行真实控制
6. 审计层记录结果
7. 前端或客户端拿到统一结果格式

这个链路的设计目标是：

- 输入可验证
- 控制可追踪
- 错误可定位
- HTTP 与 MCP 共用同一套底层能力

## MCP 接入方式

### stdio 模式

适合本地 MCP 客户端直接启动进程连接。

### HTTP 模式

适合通过远程 URL 访问 MCP。

默认对外地址：

- `http://127.0.0.1:4010/mcp`

兼容的消息入口：

- `POST /mcp`
- `POST /mcp/messages`
- `GET /mcp` 用于 SSE 连接和会话协商

## 管理 API

默认管理 API 运行在：

- `http://127.0.0.1:4000`

常用接口：

- `GET /healthz`
- `GET /api/admin/stats/overview`
- `GET /api/admin/stats/errors`
- `GET /api/admin/logs`
- `GET /api/admin/devices`
- `GET /api/admin/ha/entities/discover`

## Schema 设计说明

这一层的原则是：**外部请求尽量宽松，内部执行尽量严格**。

- MCP 工具会接收自然语言拆解后的参数
- 进入控制层之前必须经过 schema 校验
- 校验后的数据再交给工具层和 Home Assistant 访问层

### 通用字段规范

- `entity_id`
  - 类型：`string`
  - 要求：非空
  - 含义：Home Assistant 实体标识，例如 `light.living_room_main`

- `query`
  - 类型：`string`
  - 要求：非空
  - 含义：自然语言设备描述，例如“打开客厅灯”

- `domain`
  - 类型：`string`
  - 要求：可选
  - 含义：实体域，例如 `light`、`switch`、`climate`

- `room`
  - 类型：`string`
  - 要求：可选
  - 含义：房间/区域过滤条件

- `keyword`
  - 类型：`string`
  - 要求：可选
  - 含义：模糊搜索关键字

- `enabled_only`
  - 类型：`boolean`
  - 要求：可选
  - 含义：是否只返回启用设备

## 具体 Schema 参数结构

以下内容对应 `packages/mcp-server/src/models/schemas.ts` 的实际定义。

### 1. `listDevicesInputSchema`

用于列出可控制设备。

```ts
{
  domain?: string;
  room?: string;
  keyword?: string;
  enabled_only?: boolean;
}
```

#### 字段说明

- `domain`
  - 可选
  - 设备域过滤，例如 `light`、`switch`、`button`、`number`、`climate`、`sensor`
- `room`
  - 可选
  - 房间过滤，例如 `living_room`
- `keyword`
  - 可选
  - 根据显示名、别名或实体特征做模糊筛选
- `enabled_only`
  - 可选
  - `true` 表示只返回启用设备；未传或 `false` 时返回所有匹配项

---

### 2. `resolveDeviceInputSchema`

用于把自然语言请求解析为设备候选。

```ts
{
  query: string;
  domain?: string;
  room?: string;
}
```

#### 字段说明

- `query`
  - 必填
  - 最小长度 1
  - 例如：`打开客厅灯`
- `domain`
  - 可选
  - 进一步缩小解析范围
- `room`
  - 可选
  - 进一步限定房间范围

#### 返回场景

此 schema 常用于“智能匹配候选设备”，不是直接控制设备。

---

### 3. `getDeviceStateInputSchema`

用于查询某个设备当前状态。

```ts
{
  entity_id: string;
}
```

#### 字段说明

- `entity_id`
  - 必填
  - 最小长度 1
  - 例如：`switch.kitchen_main`

---

### 4. `controlDeviceInputSchema`

用于统一控制多种设备类型。

```ts
{
  entity_id: string;
  action:
    | 'turn_on'
    | 'turn_off'
    | 'press'
    | 'set_brightness'
    | 'set_value'
    | 'set_temperature'
    | 'set_hvac_mode'
    | 'set_fan_mode'
    | 'set_swing_mode';
  brightness?: number;
  value?: number;
  temperature?: number;
  hvac_mode?: 'off' | 'heat' | 'cool' | 'heat_cool' | 'auto' | 'dry' | 'fan_only';
  fan_mode?: string;
  swing_mode?: string;
}
```

#### 字段说明

- `entity_id`
  - 必填
  - 目标实体 ID
- `action`
  - 必填
  - 控制动作类型
- `brightness`
  - 可选
  - 当 `action = set_brightness` 时使用
  - 亮度值通常应在 `0 ~ 255` 之间，前端会做滑块控制
- `value`
  - 可选
  - 当 `action = set_value` 时使用
  - 用于 `number` 域
- `temperature`
  - 可选
  - 当 `action = set_temperature` 时使用
  - 用于 `climate` 域
- `hvac_mode`
  - 可选
  - 当 `action = set_hvac_mode` 时使用
  - 仅允许以下值：`off`、`heat`、`cool`、`heat_cool`、`auto`、`dry`、`fan_only`
- `fan_mode`
  - 可选
  - 当 `action = set_fan_mode` 时使用
- `swing_mode`
  - 可选
  - 当 `action = set_swing_mode` 时使用

#### 动作与参数关系

- `turn_on`
  - 只需要 `entity_id`
- `turn_off`
  - 只需要 `entity_id`
- `press`
  - 只需要 `entity_id`
- `set_brightness`
  - 需要 `entity_id` + `brightness`
- `set_value`
  - 需要 `entity_id` + `value`
- `set_temperature`
  - 需要 `entity_id` + `temperature`
- `set_hvac_mode`
  - 需要 `entity_id` + `hvac_mode`
- `set_fan_mode`
  - 需要 `entity_id` + `fan_mode`
- `set_swing_mode`
  - 需要 `entity_id` + `swing_mode`

---

### 5. `listLightsInputSchema`

用于列出灯光设备。

```ts
{
  room?: string;
  keyword?: string;
  support_brightness?: boolean;
}
```

#### 字段说明

- `room`
  - 可选
- `keyword`
  - 可选
- `support_brightness`
  - 可选
  - 是否只看支持亮度的灯

---

### 6. `resolveLightInputSchema`

用于自然语言解析灯光目标。

```ts
{
  query: string;
}
```

#### 字段说明

- `query`
  - 必填
  - 例如：`打开卧室灯`

---

### 7. `getLightStateInputSchema`

用于查询灯光状态。

```ts
{
  entity_id: string;
}
```

---

### 8. `turnOnLightInputSchema`

```ts
{
  entity_id: string;
}
```

---

### 9. `turnOffLightInputSchema`

```ts
{
  entity_id: string;
}
```

---

### 10. `setLightBrightnessInputSchema`

用于设置灯光亮度。

```ts
{
  entity_id: string;
  brightness: number;
}
```

#### 约束

- `brightness` 会先转换为数字
- 会四舍五入为整数
- 最终必须在 `0 ~ 255` 之间

---

### 11. `setLightStateInputSchema`

用于同时设置灯光开关状态与可选亮度。

```ts
{
  entity_id: string;
  state: 'on' | 'off';
  brightness?: number;
}
```

#### 字段说明

- `state`
  - 必填
  - 仅允许 `on` 或 `off`
- `brightness`
  - 可选
  - 一般与 `state = on` 联合使用

---

### 12. `pressButtonInputSchema`

```ts
{
  entity_id: string;
}
```

用于按钮类实体执行一次按下动作。

---

### 13. `setNumberValueInputSchema`

```ts
{
  entity_id: string;
  value: number;
}
```

用于数值类实体设置目标值。

---

### 14. `turnOnSwitchInputSchema`

```ts
{
  entity_id: string;
}
```

---

### 15. `turnOffSwitchInputSchema`

```ts
{
  entity_id: string;
}
```

---

### 16. `listClimateDevicesInputSchema`

用于列出空调/气候类设备。

```ts
{
  room?: string;
  keyword?: string;
}
```

---

### 17. `setClimateTemperatureInputSchema`

```ts
{
  entity_id: string;
  temperature: number;
}
```

用于设置气候设备目标温度。

---

### 18. `setClimateHvacModeInputSchema`

```ts
{
  entity_id: string;
  hvac_mode: 'off' | 'heat' | 'cool' | 'heat_cool' | 'auto' | 'dry' | 'fan_only';
}
```

#### 约束

- `hvac_mode` 是枚举值，必须是 Home Assistant 支持的 HVAC 模式之一
- 不允许传入任意字符串

---

### 19. `setClimateFanModeInputSchema`

```ts
{
  entity_id: string;
  fan_mode: string;
}
```

#### 字段说明

- `fan_mode`
  - 必填
  - 非空字符串
  - 具体可用值由目标设备自身支持的模式决定

---

### 20. `setClimateSwingModeInputSchema`

```ts
{
  entity_id: string;
  swing_mode: string;
}
```

#### 字段说明

- `swing_mode`
  - 必填
  - 非空字符串
  - 具体可用值由目标设备自身支持的模式决定

## 设备域支持说明

当前支持的设备域：

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
