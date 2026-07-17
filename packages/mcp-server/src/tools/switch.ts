import { getDeviceStateInputSchema, turnOffSwitchInputSchema, turnOnSwitchInputSchema } from '../models/schemas.js';
import { fail, ok } from '../utils/result.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { HaClient } from '../services/ha-client.js';
import type { LightRegistry } from '../services/light-registry.js';
import type { PolicyEngine } from '../services/policy-engine.js';
import { buildStateSummary, buildUnavailableError, hasExpectedPowerState, isEntityUnavailable, makeRequestId, now, waitForExpectedPowerState, writeAudit } from './shared.js';

interface CreateSwitchToolsDeps {
  registry: LightRegistry;
  policy: PolicyEngine;
  haClient: HaClient;
  auditLogger: AuditLogger;
}

export const createSwitchTools = ({ registry, policy, haClient, auditLogger }: CreateSwitchToolsDeps) => {
  const control = async (toolName: 'turn_on_switch' | 'turn_off_switch', entityId: string) => {
    const device = registry.getByEntityId(entityId);
    const policyCheck = policy.canControlSwitch(device);
    if (!policyCheck.allowed || !device) return fail(policyCheck.reason ?? 'DEVICE_NOT_FOUND', '未找到白名单中的开关设备', { entity_id: entityId });

    const beforeState = await haClient.getState(entityId).catch(() => ({ state: 'unknown' }));
    if (isEntityUnavailable(typeof beforeState.state === 'string' ? beforeState.state : undefined)) {
      return fail('DEVICE_UNAVAILABLE', '设备离线', { entity_id: entityId, state: 'unavailable' });
    }
    const beforeSummary = buildStateSummary(beforeState);
    const response = toolName === 'turn_on_switch' ? await haClient.turnOn(entityId) : await haClient.turnOff(entityId);
    const expectedState = toolName === 'turn_on_switch' ? 'on' : 'off';
    const callSummary = { state_after: expectedState };
    const summary = callSummary;
    const confirmed = true;
    const requestId = makeRequestId();

    await writeAudit(auditLogger, {
      id: requestId,
      request_id: requestId,
      timestamp: now(),
      source: 'mcp',
      tool_name: toolName,
      tool_args: { entity_id: entityId, before_state: beforeSummary.state_after, call_state: callSummary.state_after },
      resolved_device: { display_name: device.display_name, entity_id: device.entity_id },
      result: { success: true, ...summary, state_confirmed: confirmed },
      device_id: device.device_id,
      entity_id: entityId,
      result_status: 'success',
    });

    return ok({
      entity_id: entityId,
      action: toolName === 'turn_on_switch' ? 'turn_on' : 'turn_off',
      before_state: beforeSummary.state_after,
      call_state: callSummary.state_after,
      ...summary,
      state_confirmed: confirmed,
      state_warning: confirmed ? undefined : `实际状态仍为 ${summary.state_after}，但控制请求已发送`,
      raw: response,
    });
  };

  return {
    async turn_on_switch(input: unknown) {
      const parsed = turnOnSwitchInputSchema.parse(input);
      return control('turn_on_switch', parsed.entity_id);
    },

    async turn_off_switch(input: unknown) {
      const parsed = turnOffSwitchInputSchema.parse(input);
      return control('turn_off_switch', parsed.entity_id);
    },

    async get_switch_state(input: unknown) {
      const parsed = getDeviceStateInputSchema.parse(input);
      const device = registry.getByEntityId(parsed.entity_id);
      const policyCheck = policy.canControlSwitch(device);
      if (!policyCheck.allowed) return fail(policyCheck.reason, '开关不可用或不允许查询', { entity_id: parsed.entity_id });

      const state = await haClient.getState(parsed.entity_id);
      if (isEntityUnavailable(typeof state.state === 'string' ? state.state : undefined)) {
        return fail('DEVICE_UNAVAILABLE', '设备离线', { entity_id: parsed.entity_id, state: 'unavailable' });
      }
      return ok(state);
    },
  };
};
