import { randomUUID } from 'node:crypto';
import type { Runtime } from './runtime.js';
import type { LightDevice } from './models/types.js';
import { controlDeviceInputSchema, listDevicesInputSchema } from './models/schemas.js';
import { fail } from './utils/result.js';
import { getLightControlKey } from './services/room-control-profiles.js';

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const protocolVersion = '2024-11-05';

const json = (value: unknown) => JSON.stringify(value, null, 2);

const wrapToolResult = (value: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: json(value) }],
  ...(isError ? { isError: true as const } : {}),
});

const readString = (value: unknown) => (typeof value === 'string' ? value : undefined);
const readBoolean = (value: unknown) => (typeof value === 'boolean' ? value : undefined);
const resultFrom = (value: unknown) => (value && typeof value === 'object' && 'success' in value ? value : { success: true, data: value, error: null });
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const CLIMATE_KEYWORD_PATTERN = /空调|温度|制冷|制热|恒温|温控|度/;

const shouldIncludeDevice = (device: LightDevice, filter: { domain?: string; room?: string; keyword?: string }) => {
  if (filter.domain && device.domain !== filter.domain) return false;
  if (filter.room && device.room !== filter.room && device.area_name !== filter.room) return false;
  if (!filter.keyword) return true;
  const keyword = filter.keyword.toLowerCase();
  return [
    device.display_name,
    device.entity_id,
    device.room,
    device.area_name ?? '',
    device.friendly_name ?? '',
    ...device.aliases,
  ].filter(Boolean).some((value) => value.toLowerCase().includes(keyword));
};

const mergeUniqueDevices = (devices: LightDevice[]) => devices.reduce<LightDevice[]>((acc, device) => {
  if (!acc.some((item) => item.entity_id === device.entity_id)) acc.push(device);
  return acc;
}, []);

const findMainLightProfile = (runtime: Runtime, room?: string) => {
  if (room) {
    const matched = runtime.config.roomControlProfiles.find((profile) => profile.area_id === room || profile.main_light.display_name.includes(room) || profile.main_light.aliases?.some((alias) => alias.includes(room)));
    if (matched) return matched;
  }
  return runtime.config.roomControlProfiles[0];
};

const getClimateCandidates = (runtime: Runtime, filter: { room?: string; keyword?: string } = {}) => mergeUniqueDevices([
  ...runtime.registry.list({ domain: 'climate', room: filter.room, keyword: filter.keyword, enabledOnly: true }),
  ...(cachedDiscoveredDevices?.devices.filter((device) => shouldIncludeDevice(device, { domain: 'climate', room: filter.room, keyword: filter.keyword })) ?? []),
]).map((device): LightDevice => ({
  ...device,
  supports_temperature: true,
  capabilities: Array.from(new Set([...device.capabilities, 'set_temperature'])),
}));

const resolveClimateDevice = (runtime: Runtime, filter: { room?: string; keyword?: string } = {}) => {
  const candidates = getClimateCandidates(runtime, filter);
  if (candidates.length > 0) return candidates[0];
  return runtime.registry.list({ domain: 'climate', enabledOnly: true })[0] ?? cachedDiscoveredDevices?.devices.find((device) => device.domain === 'climate');
};

let cachedDiscoveredDevices: { expiresAt: number; devices: LightDevice[] } | undefined;

export const warmMcpDiscoveryCache = async (runtime: Runtime) => {
  const nowMs = Date.now();
  const devices = await runtime.haClient.discoverEntities().then((entities) => entities.map((entity): LightDevice => ({
    device_id: entity.device_id ?? entity.entity_id,
    display_name: entity.device_name ?? entity.friendly_name ?? entity.entity_id,
    aliases: [entity.device_name, entity.friendly_name, entity.area_name, entity.device_model].filter((value): value is string => Boolean(value)),
    entity_id: entity.entity_id,
    domain: (entity.domain ?? entity.entity_id.split('.')[0]) as LightDevice['domain'],
    room: entity.area_name ?? '',
    area_id: entity.area_id,
    area_name: entity.area_name,
    type: (entity.domain ?? entity.entity_id.split('.')[0]) as LightDevice['domain'],
    state: entity.state,
    friendly_name: entity.friendly_name,
    enabled: true,
    supports_brightness: entity.supports_brightness,
    supports_value: entity.supports_value,
    supports_temperature: entity.domain === 'climate' ? true : entity.supports_temperature,
    supports_hvac_mode: entity.supports_hvac_mode,
    supports_fan_mode: entity.supports_fan_mode,
    supports_swing_mode: entity.supports_swing_mode,
    supported_color_modes: entity.supported_color_modes,
    color_mode: entity.color_mode,
    brightness: entity.brightness,
    temperature_min: entity.temperature_min,
    temperature_max: entity.temperature_max,
    temperature_step: entity.temperature_step,
    temperature_unit: entity.temperature_unit,
    current_temperature: entity.current_temperature,
    target_temperature: entity.target_temperature,
    hvac_mode: entity.hvac_mode,
    hvac_modes: entity.hvac_modes,
    fan_mode: entity.fan_mode,
    fan_modes: entity.fan_modes,
    swing_mode: entity.swing_mode,
    swing_modes: entity.swing_modes,
    capabilities: entity.domain === 'climate' ? ['get_state', 'set_temperature'] : ['get_state'],
    risk_level: entity.domain === 'climate' ? 'medium' : 'low',
    capability_source: 'home_assistant',
  })));
  cachedDiscoveredDevices = { devices, expiresAt: nowMs + 60_000 };
  return devices.length;
};

export const mcpTools: McpTool[] = [
  {
    name: 'list_devices',
    description: '列出可控制的设备。用户询问空调、温度、制冷、制热或调到多少度时，必须把 domain 设为 climate 或用 keyword 搜索空调，并优先选择 climate 设备；用户询问主灯、灯光亮度、调亮/调暗时，优先选择 light 设备。',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        room: { type: 'string' },
        keyword: { type: 'string' },
        enabled_only: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'control_device',
    description: '使用统一的动作模型控制设备。用户要求调节空调温度、温度到多少度、制冷/制热温度时，必须使用 list_devices 或 list_climate_devices 找到 climate 实体后设置 action=set_temperature；用户要求调节主灯亮度时，必须使用 light 实体并设置 action=set_brightness，主灯组会自动联动成员灯。色温只用于灯光，不用于空调。',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string' },
        action: {
          type: 'string',
          enum: ['turn_on', 'turn_off', 'press', 'set_brightness', 'set_color_temp', 'set_value', 'set_temperature', 'set_hvac_mode', 'set_fan_mode', 'set_swing_mode'],
        },
        brightness: { type: 'number' },
        color_temp_kelvin: { type: 'number' },
        value: { type: 'number' },
        temperature: { type: 'number' },
        hvac_mode: { type: 'string' },
        fan_mode: { type: 'string' },
        swing_mode: { type: 'string' },
      },
      required: ['entity_id', 'action'],
      additionalProperties: false,
    },
  },
  {
    name: 'turn_on_main_light',
    description: '主灯打开直达工具。用户说“打开主灯”“把主灯打开”“开主灯”时必须优先调用此工具；它会直接使用 room-control-profiles 中的主灯开关 power_switch_entity_id，避免先 list_devices 和逐个控制成员灯。',
    inputSchema: {
      type: 'object',
      properties: {
        room: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'turn_off_main_light',
    description: '主灯关闭直达工具。用户说“关闭主灯”“把主灯关掉”“关主灯”时必须优先调用此工具；它会直接使用 room-control-profiles 中的主灯开关 power_switch_entity_id，避免先 list_devices 和逐个控制成员灯。',
    inputSchema: {
      type: 'object',
      properties: {
        room: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'set_main_light_brightness',
    description: '主灯亮度直达工具。用户说“调节主灯亮度”“主灯亮一点/暗一点”“主灯亮度设为多少”时必须优先调用此工具；它会直接控制主灯 A/B 成员，避免模型先查设备。brightness 使用 0-255。',
    inputSchema: {
      type: 'object',
      properties: {
        brightness: { type: 'number' },
        room: { type: 'string' },
      },
      required: ['brightness'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_all_lights_state',
    description: '强制用于批量灯控：当用户明确表示“打开所有灯”“关闭所有灯”“全屋开灯”“房间内关灯”时，必须优先调用此工具；它会一次性控制全屋或指定房间内所有灯光与灯型开关，严禁拆成逐个设备调用。',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['on', 'off'] },
        room: { type: 'string' },
      },
      required: ['state'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_climate_devices',
    description: '列出可控制的空调设备。用户说空调、温度、制冷、制热、调到多少度时，必须优先调用此工具查找 climate 设备；返回结果来自启动时缓存和本地 registry，不会在每次调用时全量 websocket 搜索 HA。',
    inputSchema: {
      type: 'object',
      properties: {
        room: { type: 'string' },
        keyword: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_climate_state',
    description: '获取空调设备的当前状态。',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string' },
      },
      required: ['entity_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_climate_temperature',
    description: '设置空调目标温度。用户说“把空调调到/弄到/设为 X 度”时必须调用此工具；entity_id 应来自 list_climate_devices 或 list_devices(domain=climate) 的结果。',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string' },
        temperature: { type: 'number' },
      },
      required: ['temperature'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_default_air_conditioner_temperature',
    description: '默认空调温度快捷工具。用户只说“把空调弄到/调到/设为 X 度”且没有指定其他空调时优先调用；它不会写死某个空调，而是从启动缓存和本地 registry 中选择最匹配的 climate 设备后调用 climate.set_temperature。可传 room/keyword 缩小范围。',
    inputSchema: {
      type: 'object',
      properties: {
        temperature: { type: 'number' },
        room: { type: 'string' },
        keyword: { type: 'string' },
      },
      required: ['temperature'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_climate_hvac_mode',
    description: '设置空调运行模式。',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string' },
        hvac_mode: { type: 'string' },
      },
      required: ['entity_id', 'hvac_mode'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_climate_fan_mode',
    description: '设置空调风扇模式。',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string' },
        fan_mode: { type: 'string' },
      },
      required: ['entity_id', 'fan_mode'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_climate_swing_mode',
    description: '设置空调摆风模式。',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string' },
        swing_mode: { type: 'string' },
      },
      required: ['entity_id', 'swing_mode'],
      additionalProperties: false,
    },
  },
];

const toJsonRpcError = (id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, data },
});

const toJsonRpcResult = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
});

const parseParams = (params: unknown) => (params && typeof params === 'object' ? params as Record<string, unknown> : {});

const extractToolResultPayload = (toolResult: unknown) => {
  if (!isRecord(toolResult)) return toolResult;
  const content = toolResult.content;
  if (!Array.isArray(content)) return toolResult;
  const first = content[0];
  if (!isRecord(first) || typeof first.text !== 'string') return toolResult;

  try {
    return JSON.parse(first.text) as unknown;
  } catch {
    return first.text;
  }
};

const summarizeMcpResult = (toolResult: unknown, error?: unknown) => {
  if (error) {
    return {
      success: false,
      error_code: 'MCP_TOOL_CALL_FAILED',
    };
  }

  const isErrorResult = isRecord(toolResult) && toolResult.isError === true;
  const payload = extractToolResultPayload(toolResult);
  const payloadRecord = isRecord(payload) ? payload : undefined;
  const nestedError = isRecord(payloadRecord?.error) ? payloadRecord.error : undefined;
  const nestedResult = isRecord(payloadRecord?.result) ? payloadRecord.result : undefined;
  const success =
    !isErrorResult &&
    payloadRecord?.success !== false &&
    nestedResult?.success !== false &&
    !nestedError;

  const errorCode =
    readString(payloadRecord?.error_code) ??
    readString(nestedResult?.error_code) ??
    readString(nestedError?.error_code) ??
    (success ? undefined : 'MCP_TOOL_CALL_FAILED');

  return {
    success,
    error_code: errorCode,
    state_after: readString(nestedResult?.state_after) ?? readString(payloadRecord?.state_after),
    hvac_mode_after: readString(nestedResult?.hvac_mode_after) ?? readString(payloadRecord?.hvac_mode_after),
    fan_mode_after: readString(nestedResult?.fan_mode_after) ?? readString(payloadRecord?.fan_mode_after),
    swing_mode_after: readString(nestedResult?.swing_mode_after) ?? readString(payloadRecord?.swing_mode_after),
  };
};

const writeMcpCallAudit = (
  runtime: Runtime,
  name: string,
  params: Record<string, unknown>,
  startedAt: number,
  toolResult?: unknown,
  error?: unknown,
) => {
  const requestId = `mcp_${randomUUID()}`;
  const entityId = readString(params.entity_id);
  const result = summarizeMcpResult(toolResult, error);
  const payload = extractToolResultPayload(toolResult);
  const compactPayload = name === 'list_devices' && isRecord(payload) && Array.isArray(payload.devices)
    ? { ...payload, devices: payload.devices.slice(0, 20), total: payload.devices.length, truncated: payload.devices.length > 20 }
    : payload;

  void runtime.auditLogger.write({
    id: requestId,
    request_id: requestId,
    timestamp: new Date().toISOString(),
    source: 'mcp',
    tool_name: name,
    user_input: 'MCP tools/call',
    intent: 'mcp_tool_call',
    resolved_device: entityId ? { display_name: entityId, entity_id: entityId } : undefined,
    tool_args: params,
    ha_response: {
      mcp_result: toolResult ? compactPayload : undefined,
      error: error instanceof Error ? error.message : error ? String(error) : undefined,
    },
    result,
    duration_ms: Date.now() - startedAt,
    entity_id: entityId,
    device_id: entityId,
    error_code: result.error_code,
    result_status: result.success ? 'success' : 'failure',
  }).catch((auditError) => {
    console.error('[mcp-audit] failed to write MCP tool call log', auditError);
  });
};

const dispatchToolCore = async (runtime: Runtime, name: string, params: Record<string, unknown>) => {
  if (name === 'list_devices') {
    const parsed = listDevicesInputSchema.parse(params);

    const domain = readString(parsed.domain);
    const room = readString(parsed.room);
    const keyword = readString(parsed.keyword);
    const enabledOnly = readBoolean(parsed.enabled_only) !== false;

    const baseFilter = { room, keyword, enabledOnly };
    const temperatureIntent = keyword ? CLIMATE_KEYWORD_PATTERN.test(keyword) : false;
    const registryDevices = domain
      ? runtime.registry.list({ ...baseFilter, domain })
      : temperatureIntent
        ? [...getClimateCandidates(runtime, { room, keyword }), ...runtime.registry.list({ ...baseFilter, domain: 'light' }), ...runtime.registry.list({ ...baseFilter, domain: 'switch' })]
        : [...runtime.registry.list({ ...baseFilter, domain: 'light' }), ...runtime.registry.list({ ...baseFilter, domain: 'switch' }), ...getClimateCandidates(runtime, { room, keyword })];
    const cachedDevices = cachedDiscoveredDevices?.devices.filter((device) => shouldIncludeDevice(device, { domain, room, keyword })) ?? [];
    const devices = mergeUniqueDevices([...registryDevices, ...cachedDevices]);

    const uniqueDevices = devices.sort((a, b) => {
      if (!temperatureIntent) return 0;
      if (a.domain === 'climate' && b.domain !== 'climate') return -1;
      if (a.domain !== 'climate' && b.domain === 'climate') return 1;
      return 0;
    });

    return wrapToolResult({
      devices: uniqueDevices,
    });
  }


  if (name === 'control_device') {
    const parsed = controlDeviceInputSchema.parse(params);
    const entityId = parsed.entity_id;
    const domain = entityId.split('.')[0];

    switch (parsed.action) {
      case 'turn_on':
        return wrapToolResult(resultFrom(await (domain === 'switch' ? runtime.tools.turn_on_switch({ entity_id: entityId }) : runtime.tools.turn_on_light({ entity_id: entityId }))));
      case 'turn_off':
        return wrapToolResult(resultFrom(await (domain === 'switch' ? runtime.tools.turn_off_switch({ entity_id: entityId }) : runtime.tools.turn_off_light({ entity_id: entityId }))));
      case 'press':
        return wrapToolResult(resultFrom(await runtime.tools.press_button({ entity_id: entityId })));
      case 'set_brightness':
        return wrapToolResult(resultFrom(await runtime.tools.set_light_brightness({ entity_id: entityId, brightness: parsed.brightness ?? 0 })));
      case 'set_color_temp':
        return wrapToolResult(resultFrom(await runtime.tools.set_light_state({ entity_id: entityId, state: 'on', color_temp_kelvin: parsed.color_temp_kelvin ?? 4000 })));
      case 'set_value':
        return wrapToolResult(resultFrom(await runtime.tools.set_number_value({ entity_id: entityId, value: parsed.value ?? 0 })));
      case 'set_temperature':
        return wrapToolResult(resultFrom(await runtime.tools.set_climate_temperature({ entity_id: entityId, temperature: parsed.temperature ?? 0 })));
      case 'set_hvac_mode':
        return wrapToolResult(resultFrom(await runtime.tools.set_climate_hvac_mode({ entity_id: entityId, hvac_mode: parsed.hvac_mode ?? 'auto' })));
      case 'set_fan_mode':
        return wrapToolResult(resultFrom(await runtime.tools.set_climate_fan_mode({ entity_id: entityId, fan_mode: parsed.fan_mode ?? '' })));
      case 'set_swing_mode':
        return wrapToolResult(resultFrom(await runtime.tools.set_climate_swing_mode({ entity_id: entityId, swing_mode: parsed.swing_mode ?? '' })));
      default:
        return wrapToolResult(fail('INVALID_ARGUMENT', `Unsupported action for ${domain}`, { entity_id: entityId, action: parsed.action }), true);
    }
  }

  if (name === 'turn_on_main_light' || name === 'turn_off_main_light') {
    const profile = findMainLightProfile(runtime, readString(params.room));
    const powerSwitchEntityId = profile?.main_light.power_switch_entity_id;
    if (!profile || !powerSwitchEntityId) {
      return wrapToolResult(fail('DEVICE_NOT_FOUND', '未配置主灯开关', { room: readString(params.room) }), true);
    }

    const desired = name === 'turn_on_main_light' ? 'on' : 'off';
    const result = desired === 'on'
      ? await runtime.tools.turn_on_switch({ entity_id: powerSwitchEntityId })
      : await runtime.tools.turn_off_switch({ entity_id: powerSwitchEntityId });
    return wrapToolResult(resultFrom({
      success: true,
      action: desired === 'on' ? 'turn_on' : 'turn_off',
      entity_id: powerSwitchEntityId,
      main_light: profile.main_light.display_name,
      member_entity_ids: profile.main_light.member_entity_ids,
      control_strategy: 'power_switch_direct',
      result,
    }));
  }

  if (name === 'set_main_light_brightness') {
    const profile = findMainLightProfile(runtime, readString(params.room));
    const brightness = typeof params.brightness === 'number' ? Math.max(0, Math.min(255, Math.round(params.brightness))) : undefined;
    if (!profile || brightness === undefined) {
      return wrapToolResult(fail('INVALID_ARGUMENT', '缺少主灯配置或亮度参数', { room: readString(params.room), brightness: params.brightness }), true);
    }

    const results = await Promise.all(profile.main_light.member_entity_ids.map((entityId) =>
      runtime.tools.set_light_brightness({ entity_id: entityId, brightness }),
    ));
    return wrapToolResult(resultFrom({
      success: true,
      action: 'set_brightness',
      brightness,
      main_light: profile.main_light.display_name,
      member_entity_ids: profile.main_light.member_entity_ids,
      control_strategy: 'main_light_members_direct',
      results,
    }));
  }

  if (name === 'set_all_lights_state') {
    const state = readString(params.state);
    if (state !== 'on' && state !== 'off') {
      return wrapToolResult(fail('INVALID_ARGUMENT', 'state must be on or off', { state }), true);
    }

    const room = readString(params.room);
    const devices = runtime.registry.list({ domain: 'light', room, enabledOnly: true });
    const switchDevices = runtime.registry.list({ domain: 'switch', room, enabledOnly: true });
    const targets = [...devices, ...switchDevices];
    const uniqueTargets = targets.reduce<typeof targets>((acc, device) => {
      const targetKey = device.domain === 'light'
        ? getLightControlKey(runtime.config.roomControlProfiles, device)
        : `switch:${device.entity_id}`;
      if (!acc.some((item) => {
        const itemKey = item.domain === 'light'
          ? getLightControlKey(runtime.config.roomControlProfiles, item)
          : `switch:${item.entity_id}`;
        return itemKey === targetKey;
      })) acc.push(device);
      return acc;
    }, []);

    const lightEntityIds = uniqueTargets.filter((device) => device.domain === 'light').map((device) => device.entity_id);
    const switchEntityIds = uniqueTargets.filter((device) => device.domain === 'switch').map((device) => device.entity_id);
    const tasks = [
      lightEntityIds.length > 0 ? runtime.haClient.turn(state, 'light', lightEntityIds) : Promise.resolve(null),
      switchEntityIds.length > 0 ? runtime.haClient.turn(state, 'switch', switchEntityIds) : Promise.resolve(null),
    ];
    const results = await Promise.allSettled(tasks);
    const lightResult = results[0];
    const switchResult = results[1];
    const buildResults = (entityIds: string[], domainName: 'light' | 'switch', settled: PromiseSettledResult<unknown>) => entityIds.map((entityId) => {
      if (settled.status === 'fulfilled') {
        return { success: true, data: { entity_id: entityId, action: state === 'on' ? 'turn_on' : 'turn_off', state_after: state, domain: domainName }, error: null };
      }
      return fail('SERVICE_FAILED', settled.reason instanceof Error ? settled.reason.message : String(settled.reason), { entity_id: entityId, domain: domainName });
    });
    const compactResults = [
      ...buildResults(lightEntityIds, 'light', lightResult),
      ...buildResults(switchEntityIds, 'switch', switchResult),
    ];

    return wrapToolResult(resultFrom({
      state,
      room: room ?? null,
      total: uniqueTargets.length,
      results: compactResults,
    }));
  }

  if (name === 'list_climate_devices') {
    const devices = getClimateCandidates(runtime, { room: readString(params.room), keyword: readString(params.keyword) });
    return wrapToolResult(resultFrom({ devices }));
  }
  if (name === 'get_climate_state') return wrapToolResult(resultFrom(await runtime.tools.get_climate_state(params)));
  if (name === 'set_climate_temperature') {
    const entityId = readString(params.entity_id) ?? resolveClimateDevice(runtime, { room: readString(params.room), keyword: readString(params.keyword) })?.entity_id;
    if (!entityId) return wrapToolResult(fail('DEVICE_NOT_FOUND', '未找到可调温的空调设备', { room: readString(params.room), keyword: readString(params.keyword) }), true);
    return wrapToolResult(resultFrom(await runtime.tools.set_climate_temperature({ ...params, entity_id: entityId })));
  }
  if (name === 'set_default_air_conditioner_temperature') {
    const climateDevice = resolveClimateDevice(runtime, { room: readString(params.room), keyword: readString(params.keyword) ?? '空调' });
    if (!climateDevice) return wrapToolResult(fail('DEVICE_NOT_FOUND', '未找到可调温的空调设备', { room: readString(params.room), keyword: readString(params.keyword) }), true);
    return wrapToolResult(resultFrom(await runtime.tools.set_climate_temperature({ ...params, entity_id: climateDevice.entity_id })));
  }
  if (name === 'set_climate_hvac_mode') return wrapToolResult(resultFrom(await runtime.tools.set_climate_hvac_mode(params)));
  if (name === 'set_climate_fan_mode') return wrapToolResult(resultFrom(await runtime.tools.set_climate_fan_mode(params)));
  if (name === 'set_climate_swing_mode') return wrapToolResult(resultFrom(await runtime.tools.set_climate_swing_mode(params)));

  return wrapToolResult(fail('INVALID_ARGUMENT', `Unknown tool: ${name}`), true);
};

export const dispatchTool = async (runtime: Runtime, name: string, rawParams: unknown) => {
  const startedAt = Date.now();
  const params = parseParams(rawParams);

  try {
    const result = await dispatchToolCore(runtime, name, params);
    writeMcpCallAudit(runtime, name, params, startedAt, result);
    return result;
  } catch (error) {
    writeMcpCallAudit(runtime, name, params, startedAt, undefined, error);
    throw error;
  }
};

class StdioJsonRpcTransport {
  private buffer = Buffer.alloc(0);

  constructor(private readonly onRequest: (request: JsonRpcRequest) => Promise<JsonRpcResponse | undefined>) {}

  start() {
    process.stdin.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      void this.pump();
    });
  }

  private async pump() {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headerText = this.buffer.slice(0, headerEnd).toString('utf8');
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = Number(match[1]);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (this.buffer.length < messageEnd) return;

      const body = this.buffer.slice(messageStart, messageEnd).toString('utf8');
      this.buffer = this.buffer.slice(messageEnd);

      let request: JsonRpcRequest | undefined;
      try {
        request = JSON.parse(body) as JsonRpcRequest;
      } catch {
        continue;
      }

      const response = await this.onRequest(request);
      if (response) this.write(response);
    }
  }

  write(message: JsonRpcResponse) {
    const jsonMessage = JSON.stringify(message);
    const payload = `Content-Length: ${Buffer.byteLength(jsonMessage, 'utf8')}\r\n\r\n${jsonMessage}`;
    process.stdout.write(payload);
  }
}

export const startMcp = async (runtime: Runtime) => {
  const transport = new StdioJsonRpcTransport(async (request) => {
    if (!request || request.jsonrpc !== '2.0') return undefined;

    if (request.method === 'initialize') {
      return toJsonRpcResult(request.id ?? null, {
        protocolVersion,
        serverInfo: { name: 'home-assistant-mcp', version: '1.0.0' },
        capabilities: { tools: {} },
      });
    }

    if (request.method === 'tools/list') {
      return toJsonRpcResult(request.id ?? null, { tools: mcpTools });
    }

    if (request.method === 'tools/call') {
      const params = parseParams(request.params);
      const toolName = typeof params.name === 'string' ? params.name : undefined;
      if (!toolName) return toJsonRpcError(request.id ?? null, -32602, 'Missing tool name');

      try {
        const result = await dispatchTool(runtime, toolName, params.arguments);
        return toJsonRpcResult(request.id ?? null, result);
      } catch (error) {
        return toJsonRpcResult(request.id ?? null, wrapToolResult(
          fail('SERVICE_FAILED', 'Tool execution failed', { message: error instanceof Error ? error.message : String(error) }),
          true,
        ));
      }
    }

    if (request.method === 'notifications/initialized') {
      return undefined;
    }

    if (request.id !== undefined) {
      return toJsonRpcError(request.id, -32601, `Method not found: ${request.method}`);
    }

    return undefined;
  });

  transport.start();
  process.stdin.resume();
};
