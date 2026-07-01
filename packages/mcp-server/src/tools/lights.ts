import {
  getLightStateInputSchema,
  listLightsInputSchema,
  resolveLightInputSchema,
  setLightBrightnessInputSchema,
  setLightStateInputSchema,
  turnOffLightInputSchema,
  turnOnLightInputSchema,
} from '../models/schemas.js';
import type { ToolResponse } from '../models/types.js';
import { fail, ok } from '../utils/result.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { HaClient } from '../services/ha-client.js';
import type { LightRegistry } from '../services/light-registry.js';
import type { PolicyEngine } from '../services/policy-engine.js';
import { buildStateSummary, hasExpectedPowerState, makeRequestId, now, waitForExpectedPowerState, writeAudit } from './shared.js';

interface CreateLightToolsDeps {
  registry: LightRegistry;
  policy: PolicyEngine;
  haClient: HaClient;
  auditLogger: AuditLogger;
}

const callEntityService = async (
  haClient: HaClient,
  entityId: string,
  action: 'on' | 'off',
) => {
  const isLightEntity = entityId.startsWith('light.');

  if (action === 'on') {
    const response = isLightEntity ? await haClient.turnOnLight(entityId) : await haClient.turnOn(entityId);
    const state = await haClient.getState(entityId);
    return { response, state };
  }

  const response = isLightEntity ? await haClient.turnOffLight(entityId) : await haClient.turnOff(entityId);
  const state = await haClient.getState(entityId);
  return { response, state };
};

export const createLightTools = ({ registry, policy, haClient, auditLogger }: CreateLightToolsDeps) => {
  const resolveDevice = (entityId: string) => {
    const device = registry.getByEntityId(entityId);
    const policyCheck = policy.canControlLightDomain(device);

    if (!policyCheck.allowed) {
      return {
        ok: false as const,
        failure: fail(policyCheck.reason, '设备不可控制', { entity_id: entityId }),
      };
    }

    if (!device) {
      return {
        ok: false as const,
        failure: fail('DEVICE_NOT_FOUND', '设备不可控制', { entity_id: entityId }),
      };
    }

    return { ok: true as const, device };
  };

  const auditSuccess = async (
    toolName: string,
    parsed: Record<string, unknown>,
    device: NonNullable<ReturnType<LightRegistry['getByEntityId']>>,
    summary: ReturnType<typeof buildStateSummary>,
  ) => {
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

  const auditFailure = async (
    toolName: string,
    parsed: Record<string, unknown>,
    device: NonNullable<ReturnType<LightRegistry['getByEntityId']>>,
    errorCode: string,
    summary: ReturnType<typeof buildStateSummary>,
  ) => {
    const requestId = makeRequestId();
    await writeAudit(auditLogger, {
      id: requestId,
      request_id: requestId,
      timestamp: now(),
      source: 'mcp',
      tool_name: toolName,
      tool_args: parsed,
      resolved_device: { display_name: device.display_name, entity_id: device.entity_id },
      result: { success: false, error_code: errorCode, ...summary },
      device_id: device.device_id,
      entity_id: String(parsed.entity_id),
      result_status: 'failure',
      error_code: errorCode,
    });
  };

  const drivePower = async (entityId: string, desired: 'on' | 'off') => {
    const resolved = resolveDevice(entityId);
    if (!resolved.ok) return resolved.failure;

    const beforeState = await haClient.getState(entityId);
    const beforeSummary = buildStateSummary(beforeState);
    const isLightEntity = entityId.startsWith('light.');
    const targetState = desired;
    const initial = await callEntityService(haClient, entityId, desired);
    const initialSummary = buildStateSummary(initial.state);

    let latest = await waitForExpectedPowerState(() => haClient.getState(entityId), targetState, 10, 300);
    let fallbackUsed = false;

    if (!latest.confirmed && isLightEntity && beforeSummary.state_after !== targetState) {
      await haClient.turnOffLight(entityId);
      fallbackUsed = true;
      latest = await waitForExpectedPowerState(() => haClient.getState(entityId), targetState, 10, 300);
    }

    const confirmed = latest.confirmed;
    const latestSummary = latest.summary;
    const toolName = desired === 'on' ? 'turn_on_light' : 'turn_off_light';

    if (!confirmed) {
      await auditFailure(
        toolName,
        {
          entity_id: entityId,
          before_state: beforeSummary.state_after,
          call_state: initialSummary.state_after,
          fallback_used: fallbackUsed,
        },
        resolved.device,
        'STATE_NOT_CHANGED',
        latestSummary,
      );
    } else {
      await auditSuccess(
        toolName,
        {
          entity_id: entityId,
          before_state: beforeSummary.state_after,
          call_state: initialSummary.state_after,
          fallback_used: fallbackUsed,
        },
        resolved.device,
        latestSummary,
      );
    }

    return ok({
      entity_id: entityId,
      action: desired === 'on' ? 'turn_on' : 'turn_off',
      before_state: beforeSummary.state_after,
      call_state: initialSummary.state_after,
      fallback_used: fallbackUsed,
      ...latestSummary,
      state_confirmed: confirmed,
      state_warning: confirmed ? undefined : `实际状态仍为 ${latestSummary.state_after}，但控制请求已发送`,
      raw: initial.response,
    });
  };

  const turnOn = async (entityId: string) => drivePower(entityId, 'on');

  const turnOff = async (entityId: string) => drivePower(entityId, 'off');

  const setBrightness = async (entityId: string, brightness: number) => {
    await registry.tryRefreshFromHomeAssistant(haClient);
    const device = registry.getByEntityId(entityId);
    const policyCheck = policy.canSetBrightness(device, brightness);

    if (!policyCheck.allowed) {
      return fail(policyCheck.reason, '亮度控制被拒绝', { entity_id: entityId, brightness });
    }

    const normalizedBrightness = Math.max(0, Math.min(255, Math.round(brightness)));
    const response = await haClient.turnOnLight(entityId, normalizedBrightness);
    const state = await haClient.getState(entityId);
    const summary = buildStateSummary(state);
    await auditSuccess('set_light_brightness', { entity_id: entityId, brightness: normalizedBrightness }, device!, summary);
    return ok({ entity_id: entityId, action: 'set_brightness', brightness: normalizedBrightness, ...summary, raw: response });
  };

  return {
    async list_lights(input: unknown): Promise<ToolResponse<{ devices: ReturnType<LightRegistry['list']> }>> {
      const parsed = listLightsInputSchema.parse(input);
      await registry.tryRefreshFromHomeAssistant(haClient);
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
      await registry.tryRefreshFromHomeAssistant(haClient);
      const candidates = registry.resolve(parsed.query);
      return ok({
        matched: candidates.length > 0,
        confidence: candidates.length === 1 ? 0.98 : candidates.length > 1 ? 0.7 : 0,
        candidates,
      });
    },

    async get_light_state(input: unknown) {
      const parsed = getLightStateInputSchema.parse(input);
      const device = registry.getByEntityId(parsed.entity_id);
      const policyCheck = policy.canControlLightDomain(device);

      if (!policyCheck.allowed) {
        return fail(policyCheck.reason, '未找到或不可用的设备', { entity_id: parsed.entity_id });
      }

      const state = await haClient.getState(parsed.entity_id);
      return ok(state);
    },

    async turn_on_light(input: unknown) {
      const parsed = turnOnLightInputSchema.parse(input);
      return turnOn(parsed.entity_id);
    },

    async turn_off_light(input: unknown) {
      const parsed = turnOffLightInputSchema.parse(input);
      return turnOff(parsed.entity_id);
    },

    async set_light_brightness(input: unknown) {
      const parsed = setLightBrightnessInputSchema.parse(input);
      return setBrightness(parsed.entity_id, parsed.brightness);
    },

    async set_light_state(input: unknown) {
      const parsed = setLightStateInputSchema.parse(input);

      if (parsed.state === 'off') {
        return turnOff(parsed.entity_id);
      }

      if (parsed.brightness !== undefined) {
        return setBrightness(parsed.entity_id, parsed.brightness);
      }

      return turnOn(parsed.entity_id);
    },
  };
};
