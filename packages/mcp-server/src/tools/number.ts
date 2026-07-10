import { getDeviceStateInputSchema, setNumberValueInputSchema } from '../models/schemas.js';
import { fail, ok } from '../utils/result.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { HaClient } from '../services/ha-client.js';
import type { LightRegistry } from '../services/light-registry.js';
import type { PolicyEngine } from '../services/policy-engine.js';
import { isEntityUnavailable, makeRequestId, now, writeAudit } from './shared.js';

interface CreateNumberToolsDeps {
  registry: LightRegistry;
  policy: PolicyEngine;
  haClient: HaClient;
  auditLogger: AuditLogger;
}

export const createNumberTools = ({ registry, policy, haClient, auditLogger }: CreateNumberToolsDeps) => {
  const setValue = async (entityId: string, value: number) => {
    const device = registry.getByEntityId(entityId);
    const policyCheck = policy.canSetValue(device, value);
    if (!policyCheck.allowed) return fail(policyCheck.reason, '数值实体不可设置或超出范围', { entity_id: entityId, value });

    const stateBefore = await haClient.getState(entityId);
    if (isEntityUnavailable(typeof stateBefore.state === 'string' ? stateBefore.state : undefined)) {
      return fail('DEVICE_UNAVAILABLE', '设备离线', { entity_id: entityId, state: 'unavailable' });
    }
    const response = await haClient.setNumberValue(entityId, value);
    const state = await haClient.getState(entityId);
    const requestId = makeRequestId();

    await writeAudit(auditLogger, {
      id: requestId,
      request_id: requestId,
      timestamp: now(),
      source: 'mcp',
      tool_name: 'set_number_value',
      tool_args: { entity_id: entityId, value },
      resolved_device: device ? { display_name: device.display_name, entity_id: device.entity_id } : undefined,
      result: { success: true, state_after: typeof state.state === 'string' ? state.state : 'unknown' },
      device_id: device?.device_id,
      entity_id: entityId,
      result_status: 'success',
    });

    return ok({ entity_id: entityId, action: 'set_value', value, raw: response, state_after: typeof state.state === 'string' ? state.state : 'unknown' });
  };

  return {
    async set_number_value(input: unknown) {
      const parsed = setNumberValueInputSchema.parse(input);
      return await setValue(parsed.entity_id, parsed.value);
    },

    async get_number_state(input: unknown) {
      const parsed = getDeviceStateInputSchema.parse(input);
      const device = registry.getByEntityId(parsed.entity_id);
      const policyCheck = policy.canReadNumber(device);
      if (!policyCheck.allowed) {
        return fail(policyCheck.reason, '数值实体不可用或不允许查询', { entity_id: parsed.entity_id });
      }

      return ok(await haClient.getState(parsed.entity_id));
    },
  };
};
