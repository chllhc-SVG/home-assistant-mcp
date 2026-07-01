import { getDeviceStateInputSchema, pressButtonInputSchema } from '../models/schemas.js';
import { fail, ok } from '../utils/result.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { HaClient } from '../services/ha-client.js';
import type { LightRegistry } from '../services/light-registry.js';
import type { PolicyEngine } from '../services/policy-engine.js';
import { makeRequestId, now, writeAudit } from './shared.js';

interface CreateButtonToolsDeps {
  registry: LightRegistry;
  policy: PolicyEngine;
  haClient: HaClient;
  auditLogger: AuditLogger;
}

export const createButtonTools = ({ registry, policy, haClient, auditLogger }: CreateButtonToolsDeps) => {
  const press = async (entityId: string) => {
    await registry.tryRefreshFromHomeAssistant(haClient);
    const device = registry.getByEntityId(entityId);
    const policyCheck = policy.canPressButton(device);
    if (!policyCheck.allowed) return fail(policyCheck.reason, '按钮不可用或不允许操作', { entity_id: entityId });

    const response = await haClient.pressButton(entityId);
    const state = await haClient.getState(entityId);
    const requestId = makeRequestId();

    await writeAudit(auditLogger, {
      id: requestId,
      request_id: requestId,
      timestamp: now(),
      source: 'mcp',
      tool_name: 'press_button',
      tool_args: { entity_id: entityId },
      resolved_device: device ? { display_name: device.display_name, entity_id: device.entity_id } : undefined,
      result: { success: true, state_after: typeof state.state === 'string' ? state.state : 'unknown' },
      device_id: device?.device_id,
      entity_id: entityId,
      result_status: 'success',
    });

    return ok({ entity_id: entityId, action: 'press', raw: response, state_after: typeof state.state === 'string' ? state.state : 'unknown' });
  };

  return {
    async press_button(input: unknown) {
      const parsed = pressButtonInputSchema.parse(input);
      return await press(parsed.entity_id);
    },

    async get_button_state(input: unknown) {
      const parsed = getDeviceStateInputSchema.parse(input);
      await registry.tryRefreshFromHomeAssistant(haClient);
      const device = registry.getByEntityId(parsed.entity_id);
      const policyCheck = policy.canPressButton(device);
      if (!policyCheck.allowed) return fail(policyCheck.reason, '按钮不可用或不允许查询', { entity_id: parsed.entity_id });

      return ok(await haClient.getState(parsed.entity_id));
    },
  };
};
