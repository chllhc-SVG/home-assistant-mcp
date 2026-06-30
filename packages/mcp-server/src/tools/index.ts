import { getLightStateInputSchema, listLightsInputSchema, resolveLightInputSchema, setLightBrightnessInputSchema, setLightStateInputSchema, turnOffLightInputSchema, turnOnLightInputSchema } from '../models/schemas.js';
import type { AuditEvent, ToolResponse } from '../models/types.js';
import { fail, ok } from '../utils/result.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { HaClient } from '../services/ha-client.js';
import type { LightRegistry } from '../services/light-registry.js';
import type { PolicyEngine } from '../services/policy-engine.js';

interface CreateToolsDeps {
  registry: LightRegistry;
  policy: PolicyEngine;
  haClient: HaClient;
  auditLogger: AuditLogger;
}

const makeRequestId = () => `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();

const buildStateSummary = (state: Record<string, unknown>) => {
  const current = typeof state.state === 'string' ? state.state : 'unknown';
  const attributes = state.attributes as Record<string, unknown> | undefined;
  const brightness = typeof attributes?.brightness === 'number' ? attributes.brightness : undefined;

  return {
    state_after: current,
    ...(typeof brightness === 'number' ? { brightness_after: brightness } : {}),
  };
};

const writeAudit = async (auditLogger: AuditLogger, event: AuditEvent) => {
  await auditLogger.write(event);
};

export const createTools = ({ registry, policy, haClient, auditLogger }: CreateToolsDeps) => {
  const withDevice = (entityId: string) => registry.getByEntityId(entityId);

  const controlOn = async (entityId: string, brightness?: number) => {
    const response = entityId.startsWith('light.') ? await haClient.turnOnLight(entityId, brightness) : await haClient.turnOn(entityId);
    const state = await haClient.getState(entityId);
    return { response, state };
  };

  const controlOff = async (entityId: string) => {
    const response = entityId.startsWith('light.') ? await haClient.turnOffLight(entityId) : await haClient.turnOff(entityId);
    const state = await haClient.getState(entityId);
    return { response, state };
  };

  const auditSuccess = async (toolName: string, parsed: Record<string, unknown>, device: NonNullable<ReturnType<LightRegistry['getByEntityId']>>, summary: ReturnType<typeof buildStateSummary>) => {
    const requestId = makeRequestId();
    await writeAudit(auditLogger, {
      id: requestId,
      request_id: requestId,
      timestamp: now(),
      source: 'mcp',
      tool_name: toolName,
      tool_args: parsed,
      resolved_device: { display_name: device.display_name, entity_id: device.entity_id },
      result: { success: true, ...summary },
      device_id: device.device_id,
      entity_id: String(parsed.entity_id),
      result_status: 'success',
    });
  };

  return {
    async list_lights(input: unknown): Promise<ToolResponse<{ devices: ReturnType<LightRegistry['list']> }>> {
      const parsed = listLightsInputSchema.parse(input);
      return ok({
        devices: registry.list({
          room: parsed.room,
          keyword: parsed.keyword,
          supportBrightness: parsed.support_brightness,
        }),
      });
    },

    async resolve_light(input: unknown) {
      const parsed = resolveLightInputSchema.parse(input);
      const candidates = registry.resolve(parsed.query);
      return ok({
        matched: candidates.length > 0,
        confidence: candidates.length === 1 ? 0.98 : candidates.length > 1 ? 0.7 : 0,
        candidates,
      });
    },

    async get_light_state(input: unknown) {
      const parsed = getLightStateInputSchema.parse(input);
      const device = withDevice(parsed.entity_id);
      const check = policy.canControlLight(device);
      if (!check.allowed) return fail(check.reason, '未找到或不可用的设备', { entity_id: parsed.entity_id });
      const state = await haClient.getState(parsed.entity_id);
      return ok(state);
    },

    async turn_on_light(input: unknown) {
      const parsed = turnOnLightInputSchema.parse(input);
      const device = withDevice(parsed.entity_id);
      const check = policy.canControlLight(device);
      if (!check.allowed) return fail(check.reason, '设备不可控制', { entity_id: parsed.entity_id });

      const { response, state } = await controlOn(parsed.entity_id);
      const summary = buildStateSummary(state);
      await auditSuccess('turn_on_light', parsed, device!, summary);
      return ok({ entity_id: parsed.entity_id, action: 'turn_on', ...summary, raw: response });
    },

    async turn_off_light(input: unknown) {
      const parsed = turnOffLightInputSchema.parse(input);
      const device = withDevice(parsed.entity_id);
      const check = policy.canControlLight(device);
      if (!check.allowed) return fail(check.reason, '设备不可控制', { entity_id: parsed.entity_id });

      const { response, state } = await controlOff(parsed.entity_id);
      const summary = buildStateSummary(state);
      await auditSuccess('turn_off_light', parsed, device!, summary);
      return ok({ entity_id: parsed.entity_id, action: 'turn_off', ...summary, raw: response });
    },

    async set_light_brightness(input: unknown) {
      const parsed = setLightBrightnessInputSchema.parse(input);
      const device = withDevice(parsed.entity_id);
      const check = policy.canSetBrightness(device, parsed.brightness);
      if (!check.allowed) return fail(check.reason, '亮度控制被拒绝', { entity_id: parsed.entity_id, brightness: parsed.brightness });

      const { response, state } = await controlOn(parsed.entity_id, parsed.brightness);
      const summary = buildStateSummary(state);
      await auditSuccess('set_light_brightness', parsed, device!, summary);
      return ok({ entity_id: parsed.entity_id, action: 'set_brightness', brightness: parsed.brightness, ...summary, raw: response });
    },

    async set_light_state(input: unknown) {
      const parsed = setLightStateInputSchema.parse(input);
      if (parsed.state === 'off') {
        return await this.turn_off_light({ entity_id: parsed.entity_id });
      }
      if (parsed.brightness !== undefined) {
        return await this.set_light_brightness({ entity_id: parsed.entity_id, brightness: parsed.brightness });
      }
      return await this.turn_on_light({ entity_id: parsed.entity_id });
    },
  };
};
