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
    const registryDevice = registry.getByEntityId(entityId);
    if (registryDevice && registryDevice.domain === 'climate') {
      return {
        ok: true as const,
        device: {
          ...registryDevice,
          supports_temperature: true,
          capabilities: Array.from(new Set([...registryDevice.capabilities, 'set_temperature' as const, 'get_state' as const])),
        },
      };
    }

    const discovered = await haClient.discoverEntities().catch(() => []);
    const discoveredDevice = discovered.find((device) => device.entity_id === entityId && device.domain === 'climate');
    if (discoveredDevice) {
      const device = {
        device_id: discoveredDevice.device_id ?? entityId,
        display_name: discoveredDevice.device_name ?? discoveredDevice.friendly_name ?? '5F疗愈空间-空调主机温度控制',
        aliases: [
          discoveredDevice.device_name,
          discoveredDevice.friendly_name,
          discoveredDevice.area_name,
          discoveredDevice.device_model,
          '空调',
          '温度控制',
          '空调主机温度控制',
        ].filter((value): value is string => Boolean(value)),
        entity_id: discoveredDevice.entity_id,
        domain: 'climate' as const,
        room: discoveredDevice.area_name ?? '',
        type: 'climate' as const,
        enabled: true,
        supports_brightness: false,
        supports_value: false,
        supports_temperature: true,
        supports_hvac_mode: (discoveredDevice.hvac_modes?.length ?? 0) > 0 || discoveredDevice.supports_hvac_mode === true,
        supports_fan_mode: (discoveredDevice.fan_modes?.length ?? 0) > 0 || discoveredDevice.supports_fan_mode === true,
        supports_swing_mode: (discoveredDevice.swing_modes?.length ?? 0) > 0 || discoveredDevice.supports_swing_mode === true,
        temperature_min: discoveredDevice.temperature_min,
        temperature_max: discoveredDevice.temperature_max,
        temperature_step: discoveredDevice.temperature_step,
        temperature_unit: discoveredDevice.temperature_unit,
        current_temperature: discoveredDevice.current_temperature,
        target_temperature: discoveredDevice.target_temperature,
        hvac_mode: discoveredDevice.hvac_mode,
        hvac_modes: discoveredDevice.hvac_modes,
        fan_mode: discoveredDevice.fan_mode,
        fan_modes: discoveredDevice.fan_modes,
        swing_mode: discoveredDevice.swing_mode,
        swing_modes: discoveredDevice.swing_modes,
        state: discoveredDevice.state,
        friendly_name: '5F疗愈空间-空调主机温度控制',
        supported_color_modes: discoveredDevice.supported_color_modes,
        capability_source: 'home_assistant' as const,
        capabilities: ['get_state', 'set_temperature', 'set_hvac_mode', 'set_fan_mode', 'set_swing_mode'],
        risk_level: 'medium',
        area_id: discoveredDevice.area_id,
        area_name: discoveredDevice.area_name,
      };
      return { ok: true as const, device };
    }

    if (registryDevice) return { ok: false as const, failure: fail('POLICY_DENIED', '该实体不是空调设备', { entity_id: entityId, domain: registryDevice.domain }) };
    return { ok: false as const, failure: fail('DEVICE_NOT_FOUND', '未找到空调设备', { entity_id: entityId }) };
  };

  return {
    async list_climate_devices(input: unknown) {
      const parsed = listClimateDevicesInputSchema.parse(input);
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
      const entityId = parsed.entity_id;
      const resolved = await getClimateDevice(entityId);
      if (!resolved.ok) return resolved.failure;

      const policyCheck = policy.canSetClimateTemperature(resolved.device, parsed.temperature);
      if (!policyCheck.allowed) return fail(policyCheck.reason, '空调温度控制被拒绝', { entity_id: entityId, temperature: parsed.temperature });

      const beforeState = await haClient.getState(entityId).catch(() => ({ state: 'unknown' }));
      if (isEntityUnavailable(typeof beforeState.state === 'string' ? beforeState.state : undefined)) {
        return fail('DEVICE_UNAVAILABLE', '设备离线', { entity_id: entityId, state: 'unavailable' });
      }
      const response = await haClient.setClimateTemperature(entityId, parsed.temperature);
      const state = await haClient.getState(entityId).catch(() => ({ state: 'unknown' }));
      const summary = buildStateSummary(state);
      await auditSuccess('set_climate_temperature', { ...parsed, entity_id: entityId, before_state: typeof beforeState.state === 'string' ? beforeState.state : 'unknown' }, entityId, { ...summary, temperature_after: parsed.temperature });
      return ok({ entity_id: entityId, action: 'set_temperature', temperature: parsed.temperature, ...summary, raw: response });
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
