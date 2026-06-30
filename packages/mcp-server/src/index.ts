import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { listLightsInputSchema, resolveLightInputSchema, getLightStateInputSchema, turnOnLightInputSchema, turnOffLightInputSchema, setLightBrightnessInputSchema, setLightStateInputSchema } from './models/schemas.js';
import { LightRegistry } from './services/light-registry.js';
import { HaClient } from './services/ha-client.js';
import { ConsoleAuditSink } from './services/audit-logger.js';
import { fail, ok } from './utils/result.js';
import type { AuditEvent, LightDevice } from './models/types.js';

const registryPath = process.env.LIGHTS_CONFIG_PATH ?? join(process.cwd(), 'config', 'lights.json');
const baseUrl = process.env.HOME_ASSISTANT_BASE_URL ?? 'http://192.168.150.11:8123';
const token = process.env.HOME_ASSISTANT_TOKEN ?? process.env.HA_TOKEN ?? '';

const loadDevices = (): LightDevice[] => {
  const raw = readFileSync(registryPath, 'utf8');
  const parsed = JSON.parse(raw) as { lights: LightDevice[] };
  return parsed.lights;
};

const registry = new LightRegistry(loadDevices());
const haClient = new HaClient(baseUrl, token, Number(process.env.HOME_ASSISTANT_TIMEOUT_MS ?? 5000));
const audit = new ConsoleAuditSink();

const writeAudit = async (event: AuditEvent) => {
  await audit.write(event);
};

export const tools = {
  list_lights: async (input: unknown) => {
    const parsed = listLightsInputSchema.parse(input);
    const devices = registry.list({
      room: parsed.room,
      keyword: parsed.keyword,
      supportBrightness: parsed.support_brightness,
    });
    return ok({ devices });
  },
  resolve_light: async (input: unknown) => {
    const parsed = resolveLightInputSchema.parse(input);
    const candidates = registry.resolve(parsed.query);
    return ok({ matched: candidates.length > 0, confidence: candidates.length === 1 ? 0.98 : candidates.length > 1 ? 0.7 : 0, candidates });
  },
  get_light_state: async (input: unknown) => {
    const parsed = getLightStateInputSchema.parse(input);
    const data = await haClient.getState(parsed.entity_id);
    return ok(data);
  },
  turn_on_light: async (input: unknown) => {
    const parsed = turnOnLightInputSchema.parse(input);
    const device = registry.getByEntityId(parsed.entity_id);
    if (!device) return fail('DEVICE_NOT_FOUND', '未找到设备', { entity_id: parsed.entity_id });
    const response = await haClient.turnOnLight(parsed.entity_id);
    await writeAudit({
      request_id: `req_${Date.now()}`,
      timestamp: new Date().toISOString(),
      source: 'mcp',
      tool_name: 'turn_on_light',
      tool_args: parsed,
      resolved_device: { display_name: device.display_name, entity_id: device.entity_id },
      result: { success: true, state_after: 'on' },
    });
    return ok({ entity_id: parsed.entity_id, action: 'turn_on', state_after: 'on', raw: response });
  },
  turn_off_light: async (input: unknown) => {
    const parsed = turnOffLightInputSchema.parse(input);
    const device = registry.getByEntityId(parsed.entity_id);
    if (!device) return fail('DEVICE_NOT_FOUND', '未找到设备', { entity_id: parsed.entity_id });
    const response = await haClient.turnOffLight(parsed.entity_id);
    await writeAudit({
      request_id: `req_${Date.now()}`,
      timestamp: new Date().toISOString(),
      source: 'mcp',
      tool_name: 'turn_off_light',
      tool_args: parsed,
      resolved_device: { display_name: device.display_name, entity_id: device.entity_id },
      result: { success: true, state_after: 'off' },
    });
    return ok({ entity_id: parsed.entity_id, action: 'turn_off', state_after: 'off', raw: response });
  },
  set_light_brightness: async (input: unknown) => {
    const parsed = setLightBrightnessInputSchema.parse(input);
    const device = registry.getByEntityId(parsed.entity_id);
    if (!device) return fail('DEVICE_NOT_FOUND', '未找到设备', { entity_id: parsed.entity_id });
    if (!device.supports_brightness) return fail('BRIGHTNESS_NOT_SUPPORTED', '该灯光设备不支持亮度调节', { entity_id: parsed.entity_id });
    const response = await haClient.turnOnLight(parsed.entity_id, parsed.brightness);
    await writeAudit({
      request_id: `req_${Date.now()}`,
      timestamp: new Date().toISOString(),
      source: 'mcp',
      tool_name: 'set_light_brightness',
      tool_args: parsed,
      resolved_device: { display_name: device.display_name, entity_id: device.entity_id },
      result: { success: true, state_after: 'on', brightness_after: parsed.brightness },
    });
    return ok({ entity_id: parsed.entity_id, action: 'set_brightness', brightness: parsed.brightness, state_after: 'on', raw: response });
  },
  set_light_state: async (input: unknown) => {
    const parsed = setLightStateInputSchema.parse(input);
    if (parsed.state === 'off') {
      return tools.turn_off_light({ entity_id: parsed.entity_id });
    }
    return tools.set_light_brightness({ entity_id: parsed.entity_id, brightness: parsed.brightness ?? 255 });
  },
};

export type ToolName = keyof typeof tools;