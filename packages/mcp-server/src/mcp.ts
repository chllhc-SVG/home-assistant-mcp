import type { Runtime } from './runtime.js';
import { controlDeviceInputSchema, getDeviceStateInputSchema, listDevicesInputSchema, resolveDeviceInputSchema } from './models/schemas.js';
import { fail } from './utils/result.js';

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

export const mcpTools: McpTool[] = [
  {
    name: 'resolve_device',
    description: '将自然语言设备查询解析为匹配的设备候选项。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        domain: { type: 'string' },
        room: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_devices',
    description: '列出可控制的设备。',
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
    name: 'get_device_state',
    description: '获取设备的当前状态。',
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
    name: 'control_device',
    description: '使用统一的动作模型控制设备。对 light 设备可控制开关、亮度和色温（Kelvin）；对 climate 设备可控制温度、模式和风速。色温只用于灯光，不用于空调。',
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
    name: 'list_climate_devices',
    description: '列出可控制的空调设备。',
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
    description: '设置空调目标温度。',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string' },
        temperature: { type: 'number' },
      },
      required: ['entity_id', 'temperature'],
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

export const dispatchTool = async (runtime: Runtime, name: string, rawParams: unknown) => {
  const params = parseParams(rawParams);

  if (name === 'resolve_device') {
    const parsed = resolveDeviceInputSchema.parse(params);
    await runtime.registry.tryRefreshFromHomeAssistant(runtime.haClient);
    const candidates = runtime.registry.resolve(parsed.query, { domain: readString(parsed.domain), room: readString(parsed.room) });
    return wrapToolResult({
      matched: candidates.length === 1,
      confidence: candidates.length === 1 ? 0.98 : candidates.length > 1 ? 0.7 : 0,
      candidates,
    });
  }

  if (name === 'list_devices') {
    const parsed = listDevicesInputSchema.parse(params);
    await runtime.registry.tryRefreshFromHomeAssistant(runtime.haClient);
    return wrapToolResult({
      devices: runtime.registry.list({
        domain: readString(parsed.domain),
        room: readString(parsed.room),
        keyword: readString(parsed.keyword),
        enabledOnly: readBoolean(parsed.enabled_only) !== false,
      }),
    });
  }

  if (name === 'get_device_state') {
    const parsed = getDeviceStateInputSchema.parse(params);
    const entityId = parsed.entity_id;
    const domain = entityId.split('.')[0];
    const tool =
      domain === 'switch' ? runtime.tools.get_switch_state :
      domain === 'button' ? runtime.tools.get_button_state :
      domain === 'number' ? runtime.tools.get_number_state :
      domain === 'climate' ? runtime.tools.get_climate_state :
      domain === 'sensor' ? runtime.tools.get_sensor_state :
      runtime.tools.get_light_state;
    return wrapToolResult(resultFrom(await tool({ entity_id: entityId })));
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

  if (name === 'list_climate_devices') return wrapToolResult(resultFrom(await runtime.tools.list_climate_devices(params)));
  if (name === 'get_climate_state') return wrapToolResult(resultFrom(await runtime.tools.get_climate_state(params)));
  if (name === 'set_climate_temperature') return wrapToolResult(resultFrom(await runtime.tools.set_climate_temperature(params)));
  if (name === 'set_climate_hvac_mode') return wrapToolResult(resultFrom(await runtime.tools.set_climate_hvac_mode(params)));
  if (name === 'set_climate_fan_mode') return wrapToolResult(resultFrom(await runtime.tools.set_climate_fan_mode(params)));
  if (name === 'set_climate_swing_mode') return wrapToolResult(resultFrom(await runtime.tools.set_climate_swing_mode(params)));

  return wrapToolResult(fail('INVALID_ARGUMENT', `Unknown tool: ${name}`), true);
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
