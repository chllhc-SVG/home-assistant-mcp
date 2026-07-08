import {
  getDeviceStateInputSchema,
  listClimateDevicesInputSchema,
  setClimateFanModeInputSchema,
  setClimateHvacModeInputSchema,
  setClimateSwingModeInputSchema,
  setClimateTemperatureInputSchema,
} from '../models/schemas.js';
import { fail, ok } from '../utils/result.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { HaClient } from '../services/ha-client.js';
import type { LightRegistry } from '../services/light-registry.js';
import type { PolicyEngine } from '../services/policy-engine.js';
import { buildStateSummary, isEntityUnavailable, makeRequestId, now, waitForExpectedPowerState, writeAudit } from './shared.js';

interface CreateClimateToolsDeps {
  registry: LightRegistry;
  policy: PolicyEngine;
  haClient: HaClient;
  auditLogger: AuditLogger;
}

export const createClimateTools = ({ registry, policy, haClient, auditLogger }: CreateClimateToolsDeps) => {
  const auditSuccess = async (
    toolName: string,
    args: Record<string, unknown>,
    entityId: string,
    summary: ReturnType<typeof buildStateSummary>,
  ) => {
    const device = registry.getByEntityId(entityId);
    const requestId = makeRequestId();

    await writeAudit(auditLogger, {
      id: requestId,
      request_id: requestId,
      timestamp: now(),
      source: 'mcp',
      tool_name: toolName,
      tool_args: args,
      resolved_device: device ? { display_name: device.display_name, entity_id: device.entity_id } : undefined,
      result: { success: true, ...summary },
      device_id: device?.device_id,
      entity_id: entityId,
      result_status: 'success',
    });
  };

  const getClimateDevice = async (entityId: string) => {
    await registry.tryRefreshFromHomeAssistant(haClient);
    const device = registry.getByEntityId(entityId);
    if (!device) return { ok: false as const, failure: fail('DEVICE_NOT_FOUND', '未找到空调设备', { entity_id: entityId }) };
    if (device.domain !== 'climate') return { ok: false as const, failure: fail('POLICY_DENIED', '该实体不是空调设备', { entity_id: entityId, domain: device.domain }) };
    return { ok: true as const, device };
  };

  return {
    async list_climate_devices(input: unknown) {
      const parsed = listClimateDevicesInputSchema.parse(input);
      await registry.tryRefreshFromHomeAssistant(haClient);
      return ok({
        devices: registry.list({ room: parsed.room, keyword: parsed.keyword }).filter((device) => device.domain === 'climate'),
      });
    },

    async get_climate_state(input: unknown) {
      const parsed = getDeviceStateInputSchema.parse(input);
      const resolved = await getClimateDevice(parsed.entity_id);
      if (!resolved.ok) return resolved.failure;

      return ok(await haClient.getState(parsed.entity_id));
    },

    async set_climate_temperature(input: unknown) {
      const parsed = setClimateTemperatureInputSchema.parse(input);
      const resolved = await getClimateDevice(parsed.entity_id);
      if (!resolved.ok) return resolved.failure;

      const policyCheck = policy.canSetClimateTemperature(resolved.device, parsed.temperature);
      if (!policyCheck.allowed) return fail(policyCheck.reason, '空调温度控制被拒绝', { entity_id: parsed.entity_id, temperature: parsed.temperature });

      const beforeState = await haClient.getState(parsed.entity_id);
      if (isEntityUnavailable(typeof beforeState.state === 'string' ? beforeState.state : undefined)) {
        return fail('DEVICE_UNAVAILABLE', '设备离线', { entity_id: parsed.entity_id, state: 'unavailable' });
      }
      const response = await haClient.setClimateTemperature(parsed.entity_id, parsed.temperature);
      const state = await haClient.getState(parsed.entity_id);
      const summary = buildStateSummary(state);
      await auditSuccess('set_climate_temperature', { ...parsed, before_state: typeof beforeState.state === 'string' ? beforeState.state : 'unknown' }, parsed.entity_id, { ...summary, temperature_after: parsed.temperature });
      return ok({ entity_id: parsed.entity_id, action: 'set_temperature', temperature: parsed.temperature, ...summary, raw: response });
    },

    async set_climate_hvac_mode(input: unknown) {
      const parsed = setClimateHvacModeInputSchema.parse(input);
      const resolved = await getClimateDevice(parsed.entity_id);
      if (!resolved.ok) return resolved.failure;

      const policyCheck = policy.canSetClimateHvacMode(resolved.device, parsed.hvac_mode);
      if (!policyCheck.allowed) return fail(policyCheck.reason, '空调模式控制被拒绝', { entity_id: parsed.entity_id, hvac_mode: parsed.hvac_mode });

      const beforeState = await haClient.getState(parsed.entity_id);
      if (isEntityUnavailable(typeof beforeState.state === 'string' ? beforeState.state : undefined)) {
        return fail('DEVICE_UNAVAILABLE', '设备离线', { entity_id: parsed.entity_id, state: 'unavailable' });
      }
      const response = await haClient.setClimateHvacMode(parsed.entity_id, parsed.hvac_mode);
      const state = await haClient.getState(parsed.entity_id);
      const summary = buildStateSummary(state);
      const confirmed = await waitForExpectedPowerState(() => haClient.getState(parsed.entity_id), parsed.hvac_mode === 'off' ? 'off' : 'on', 3, 300);
      await auditSuccess('set_climate_hvac_mode', { ...parsed, before_state: typeof beforeState.state === 'string' ? beforeState.state : 'unknown' }, parsed.entity_id, summary);
      return ok({ entity_id: parsed.entity_id, action: 'set_hvac_mode', hvac_mode: parsed.hvac_mode, ...summary, state_confirmed: confirmed.confirmed, raw: response });
    },

    async set_climate_fan_mode(input: unknown) {
      const parsed = setClimateFanModeInputSchema.parse(input);
      const resolved = await getClimateDevice(parsed.entity_id);
      if (!resolved.ok) return resolved.failure;

      const policyCheck = policy.canSetClimateFanMode(resolved.device, parsed.fan_mode);
      if (!policyCheck.allowed) return fail(policyCheck.reason, '空调风扇模式控制被拒绝', { entity_id: parsed.entity_id, fan_mode: parsed.fan_mode });

      const beforeState = await haClient.getState(parsed.entity_id);
      if (isEntityUnavailable(typeof beforeState.state === 'string' ? beforeState.state : undefined)) {
        return fail('DEVICE_UNAVAILABLE', '设备离线', { entity_id: parsed.entity_id, state: 'unavailable' });
      }
      const response = await haClient.setClimateFanMode(parsed.entity_id, parsed.fan_mode);
      const state = await haClient.getState(parsed.entity_id);
      const summary = buildStateSummary(state);
      await auditSuccess('set_climate_fan_mode', { ...parsed, before_state: typeof beforeState.state === 'string' ? beforeState.state : 'unknown' }, parsed.entity_id, summary);
      return ok({ entity_id: parsed.entity_id, action: 'set_fan_mode', fan_mode: parsed.fan_mode, ...summary, raw: response });
    },

    async set_climate_swing_mode(input: unknown) {
      const parsed = setClimateSwingModeInputSchema.parse(input);
      const resolved = await getClimateDevice(parsed.entity_id);
      if (!resolved.ok) return resolved.failure;

      const policyCheck = policy.canSetClimateSwingMode(resolved.device, parsed.swing_mode);
      if (!policyCheck.allowed) return fail(policyCheck.reason, '空调摆风模式控制被拒绝', { entity_id: parsed.entity_id, swing_mode: parsed.swing_mode });

      const beforeState = await haClient.getState(parsed.entity_id);
      if (isEntityUnavailable(typeof beforeState.state === 'string' ? beforeState.state : undefined)) {
        return fail('DEVICE_UNAVAILABLE', '设备离线', { entity_id: parsed.entity_id, state: 'unavailable' });
      }
      const response = await haClient.setClimateSwingMode(parsed.entity_id, parsed.swing_mode);
      const state = await haClient.getState(parsed.entity_id);
      const summary = buildStateSummary(state);
      await auditSuccess('set_climate_swing_mode', { ...parsed, before_state: typeof beforeState.state === 'string' ? beforeState.state : 'unknown' }, parsed.entity_id, summary);
      return ok({ entity_id: parsed.entity_id, action: 'set_swing_mode', swing_mode: parsed.swing_mode, ...summary, raw: response });
    },
  };
};
