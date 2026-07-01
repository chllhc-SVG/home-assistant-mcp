import { getDeviceStateInputSchema } from '../models/schemas.js';
import { fail, ok } from '../utils/result.js';
import type { HaClient } from '../services/ha-client.js';
import type { LightRegistry } from '../services/light-registry.js';
import type { PolicyEngine } from '../services/policy-engine.js';

interface CreateSensorToolsDeps {
  registry: LightRegistry;
  policy: PolicyEngine;
  haClient: HaClient;
}

export const createSensorTools = ({ registry, policy, haClient }: CreateSensorToolsDeps) => ({
  async get_sensor_state(input: unknown) {
    const parsed = getDeviceStateInputSchema.parse(input);
    await registry.tryRefreshFromHomeAssistant(haClient);
    const device = registry.getByEntityId(parsed.entity_id);
    const policyCheck = policy.canReadSensor(device);
    if (!policyCheck.allowed) return fail(policyCheck.reason, '传感器不可用或不允许查询', { entity_id: parsed.entity_id });

    return ok(await haClient.getState(parsed.entity_id));
  },
});
