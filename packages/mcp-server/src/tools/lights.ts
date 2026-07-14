import {
  getLightStateInputSchema,
  listLightsInputSchema,
  resolveLightInputSchema,
  setLightBrightnessInputSchema,
  setLightStateInputSchema,
  turnOffLightInputSchema,
  turnOnLightInputSchema,
} from '../models/schemas.js';
import type { LightDevice, RoomControlProfile, ToolResponse } from '../models/types.js';
import { fail, ok } from '../utils/result.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { HaClient } from '../services/ha-client.js';
import type { LightRegistry } from '../services/light-registry.js';
import type { PolicyEngine } from '../services/policy-engine.js';
import { findMainLightProfile, getLightControlEntityIds, summarizeMainLightProfiles } from '../services/room-control-profiles.js';
import { buildStateSummary, isEntityUnavailable, makeRequestId, now, wait, waitForExpectedPowerState, writeAudit } from './shared.js';

interface CreateLightToolsDeps {
  registry: LightRegistry;
  policy: PolicyEngine;
  haClient: HaClient;
  auditLogger: AuditLogger;
  roomControlProfiles: RoomControlProfile[];
}

type PowerAction = 'on' | 'off';

const stateOf = (state: Record<string, unknown>) => typeof state.state === 'string' ? state.state : 'unknown';
const toMemberStates = (entityIds: string[], states: Record<string, unknown>[]) =>
  entityIds.map((entityId, index) => ({ entity_id: entityId, state: stateOf(states[index] ?? {}) }));

export const createLightTools = ({ registry, policy, haClient, auditLogger, roomControlProfiles }: CreateLightToolsDeps) => {
  const resolveDevice = (entityId: string) => {
    const device = registry.getByEntityId(entityId);
    const policyCheck = policy.canControlLightDomain(device);
    if (!policyCheck.allowed || !device) {
      return { ok: false as const, failure: fail(policyCheck.reason ?? 'DEVICE_NOT_FOUND', '设备不可控制', { entity_id: entityId }) };
    }
    return { ok: true as const, device };
  };

  const resolvePlan = (device: LightDevice) => {
    const profile = findMainLightProfile(roomControlProfiles, device);
    return {
      profile,
      entityIds: getLightControlEntityIds(roomControlProfiles, device),
      powerSwitchEntityId: profile?.main_light.power_switch_entity_id,
    };
  };

  const validateMembers = (entityIds: string[]) => {
    for (const entityId of entityIds) {
      const device = registry.getByEntityId(entityId);
      const policyCheck = policy.canControlLightDomain(device);
      if (!policyCheck.allowed || !device) {
        return fail(policyCheck.reason ?? 'DEVICE_NOT_FOUND', '主灯组中存在不可控制的成员', { entity_id: entityId });
      }
    }
    return undefined;
  };

  const readMemberStates = (entityIds: string[]) => Promise.all(entityIds.map((entityId) => haClient.getState(entityId)));

  const waitForExpectedMemberStates = async (entityIds: string[], expected: PowerAction, retries = 3, delayMs = 300) => {
    let states: Record<string, unknown>[] = [];
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      states = await readMemberStates(entityIds);
      if (states.every((state) => stateOf(state) === expected)) {
        return { confirmed: true as const, states };
      }
      if (attempt < retries) await wait(delayMs);
    }
    return { confirmed: false as const, states };
  };

  const ensurePowerSwitchOn = async (powerSwitchEntityId?: string) => {
    if (!powerSwitchEntityId) return { stateBefore: undefined };

    const powerSwitch = registry.getByEntityId(powerSwitchEntityId);
    const policyCheck = policy.canControlSwitch(powerSwitch);
    if (!policyCheck.allowed || !powerSwitch) {
      return { failure: fail(policyCheck.reason ?? 'DEVICE_NOT_FOUND', '主灯供电开关不可控制', { entity_id: powerSwitchEntityId }) };
    }

    const state = await haClient.getState(powerSwitchEntityId);
    const stateBefore = stateOf(state);
    if (isEntityUnavailable(stateBefore)) {
      return { failure: fail('DEVICE_UNAVAILABLE', '主灯供电开关离线', { entity_id: powerSwitchEntityId }) };
    }
    if (stateBefore === 'on') return { stateBefore };

    await haClient.turnOn(powerSwitchEntityId);
    const confirmed = await waitForExpectedPowerState(() => haClient.getState(powerSwitchEntityId), 'on', 3, 300);
    if (!confirmed.confirmed) {
      return { failure: fail('STATE_NOT_CHANGED', '主灯供电开关未能打开', { entity_id: powerSwitchEntityId, state_after: confirmed.summary.state_after }) };
    }
    return { stateBefore };
  };

  const audit = async (
    success: boolean,
    toolName: string,
    args: Record<string, unknown>,
    device: LightDevice,
    state: Record<string, unknown>,
  ) => {
    const requestId = makeRequestId();
    await writeAudit(auditLogger, {
      id: requestId,
      request_id: requestId,
      timestamp: now(),
      source: 'mcp',
      tool_name: toolName,
      tool_args: args,
      resolved_device: { display_name: device.display_name, entity_id: device.entity_id },
      result: success ? { success: true, ...buildStateSummary(state) } : { success: false, error_code: 'STATE_NOT_CHANGED', ...buildStateSummary(state) },
      device_id: device.device_id,
      entity_id: device.entity_id,
      result_status: success ? 'success' : 'failure',
      error_code: success ? undefined : 'STATE_NOT_CHANGED',
    });
  };

  const drivePower = async (entityId: string, desired: PowerAction) => {
    const resolved = resolveDevice(entityId);
    if (!resolved.ok) return resolved.failure;

    const plan = resolvePlan(resolved.device);
    const invalidMember = validateMembers(plan.entityIds);
    if (invalidMember) return invalidMember;

    const beforeStates = await readMemberStates(plan.entityIds);
    const unavailable = beforeStates.find((state) => isEntityUnavailable(stateOf(state)));
    if (unavailable) return fail('DEVICE_UNAVAILABLE', '主灯组中存在离线设备', { entity_id: entityId, state: stateOf(unavailable) });

    const powerResult = desired === 'on' ? await ensurePowerSwitchOn(plan.powerSwitchEntityId) : { stateBefore: undefined };
    if ('failure' in powerResult) return powerResult.failure;

    const response = await Promise.all(plan.entityIds.map((memberEntityId) =>
      desired === 'on' ? haClient.turnOnLight(memberEntityId) : haClient.turnOffLight(memberEntityId),
    ));
    const confirmed = await waitForExpectedMemberStates(plan.entityIds, desired);
    const primaryState = confirmed.states[0] ?? { state: 'unknown' };
    const memberStates = toMemberStates(plan.entityIds, confirmed.states);
    const toolName = desired === 'on' ? 'turn_on_light' : 'turn_off_light';

    await audit(confirmed.confirmed, toolName, {
      entity_id: entityId,
      member_entity_ids: plan.entityIds,
      power_switch_entity_id: plan.powerSwitchEntityId,
      power_switch_state_before: powerResult.stateBefore,
      member_states_before: toMemberStates(plan.entityIds, beforeStates),
      member_states_after: memberStates,
    }, resolved.device, primaryState);

    return ok({
      entity_id: entityId,
      action: desired === 'on' ? 'turn_on' : 'turn_off',
      grouped_entities: plan.entityIds,
      power_switch: plan.powerSwitchEntityId,
      power_switch_state_before: powerResult.stateBefore,
      member_states: memberStates,
      ...buildStateSummary(primaryState),
      state_confirmed: confirmed.confirmed,
      state_warning: confirmed.confirmed ? undefined : '控制请求已发送，但并非所有主灯成员都已确认到目标状态',
      raw: response,
    });
  };

  const setLightLevel = async (entityId: string, brightness?: number, colorTempKelvin?: number) => {
    const resolved = resolveDevice(entityId);
    if (!resolved.ok) return resolved.failure;

    const plan = resolvePlan(resolved.device);
    const invalidMember = validateMembers(plan.entityIds);
    if (invalidMember) return invalidMember;
    for (const memberEntityId of plan.entityIds) {
      const member = registry.getByEntityId(memberEntityId);
      const policyCheck = policy.canSetBrightness(member, brightness ?? 0);
      if (!policyCheck.allowed) {
        return fail(policyCheck.reason, '主灯组中存在不支持亮度或色温控制的成员', { entity_id: memberEntityId });
      }
    }

    const powerResult = await ensurePowerSwitchOn(plan.powerSwitchEntityId);
    if ('failure' in powerResult) return powerResult.failure;

    const response = await Promise.all(plan.entityIds.map((memberEntityId) =>
      haClient.turnOnLight(memberEntityId, brightness, colorTempKelvin),
    ));
    const confirmed = await waitForExpectedMemberStates(plan.entityIds, 'on');
    const primaryState = confirmed.states[0] ?? { state: 'unknown' };
    const memberStates = toMemberStates(plan.entityIds, confirmed.states);
    const action = brightness === undefined ? 'set_color_temp' : 'set_brightness';

    await audit(confirmed.confirmed, action === 'set_brightness' ? 'set_light_brightness' : 'set_light_state', {
      entity_id: entityId,
      member_entity_ids: plan.entityIds,
      power_switch_entity_id: plan.powerSwitchEntityId,
      power_switch_state_before: powerResult.stateBefore,
      ...(brightness === undefined ? { color_temp_kelvin: colorTempKelvin } : { brightness }),
      member_states_after: memberStates,
    }, resolved.device, primaryState);

    return ok({
      entity_id: entityId,
      action,
      ...(brightness === undefined ? { color_temp_kelvin: colorTempKelvin } : { brightness }),
      grouped_entities: plan.entityIds,
      power_switch: plan.powerSwitchEntityId,
      power_switch_state_before: powerResult.stateBefore,
      member_states: memberStates,
      ...buildStateSummary(primaryState),
      state_confirmed: confirmed.confirmed,
      raw: response,
    });
  };

  const summarizeLights = (devices: LightDevice[]) => summarizeMainLightProfiles(roomControlProfiles, devices);

  return {
    async list_lights(input: unknown): Promise<ToolResponse<{ devices: LightDevice[] }>> {
      const parsed = listLightsInputSchema.parse(input);
      return ok({
        devices: summarizeLights(registry.list({
          room: parsed.room,
          keyword: parsed.keyword,
          supportBrightness: parsed.support_brightness,
        })),
      });
    },

    async resolve_light(input: unknown) {
      const parsed = resolveLightInputSchema.parse(input);
      const matchedByName = roomControlProfiles.flatMap((profile) => {
        const names = [profile.main_light.display_name, ...(profile.main_light.aliases ?? [])];
        if (!names.some((name) => name.includes(parsed.query))) return [];
        return profile.main_light.member_entity_ids
          .map((entityId) => registry.getByEntityId(entityId))
          .filter((device): device is LightDevice => Boolean(device));
      });
      const candidates = summarizeLights([
        ...registry.resolve(parsed.query),
        ...registry.list({ enabledOnly: true }).filter((device) => {
          const normalizedQuery = parsed.query.trim().toLowerCase();
          const semanticFields = [
            device.display_name,
            device.entity_id,
            device.room,
            device.area_name ?? '',
            device.friendly_name ?? '',
            ...device.aliases,
          ].map((value) => value.toLowerCase());
          return semanticFields.some((value) => value.includes(normalizedQuery));
        }),
        ...matchedByName.filter((device, index, devices) => devices.findIndex((item) => item.entity_id === device.entity_id) === index),
      ]);
      return ok({
        matched: candidates.length > 0,
        confidence: candidates.length === 1 ? 0.98 : candidates.length > 1 ? 0.7 : 0,
        candidates,
      });
    },

    async get_light_state(input: unknown) {
      const parsed = getLightStateInputSchema.parse(input);
      const resolved = resolveDevice(parsed.entity_id);
      if (!resolved.ok) return resolved.failure;

      const plan = resolvePlan(resolved.device);
      if (plan.powerSwitchEntityId) {
        const switchState = await haClient.getState(plan.powerSwitchEntityId).catch(() => undefined);
        if (stateOf(switchState ?? {}) !== 'on') {
          return ok({
            entity_id: parsed.entity_id,
            state: 'off',
            friendly_name: plan.profile?.main_light.display_name ?? resolved.device.display_name,
            power_switch: plan.powerSwitchEntityId,
            power_switch_state: stateOf(switchState ?? {}),
            grouped_entities: plan.entityIds,
          });
        }
      }

      const states = await readMemberStates(plan.entityIds);
      const unavailable = states.find((state) => isEntityUnavailable(stateOf(state)));
      if (unavailable) return fail('DEVICE_UNAVAILABLE', '设备离线', { entity_id: parsed.entity_id, state: stateOf(unavailable) });
      return ok({
        ...(states[0] ?? { state: 'unknown' }),
        grouped_entities: plan.entityIds,
        member_states: toMemberStates(plan.entityIds, states),
      });
    },

    async turn_on_light(input: unknown) {
      const parsed = turnOnLightInputSchema.parse(input);
      return drivePower(parsed.entity_id, 'on');
    },

    async turn_off_light(input: unknown) {
      const parsed = turnOffLightInputSchema.parse(input);
      return drivePower(parsed.entity_id, 'off');
    },

    async set_light_brightness(input: unknown) {
      const parsed = setLightBrightnessInputSchema.parse(input);
      return setLightLevel(parsed.entity_id, Math.max(0, Math.min(255, Math.round(parsed.brightness))));
    },

    async set_light_state(input: unknown) {
      const parsed = setLightStateInputSchema.parse(input);
      if (parsed.state === 'off') return drivePower(parsed.entity_id, 'off');
      if (parsed.brightness !== undefined) return setLightLevel(parsed.entity_id, parsed.brightness);
      if (parsed.color_temp_kelvin !== undefined) return setLightLevel(parsed.entity_id, undefined, parsed.color_temp_kelvin);
      return drivePower(parsed.entity_id, 'on');
    },
  };
};
