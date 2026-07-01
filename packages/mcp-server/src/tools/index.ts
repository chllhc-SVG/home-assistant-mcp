import type { AuditLogger } from '../services/audit-logger.js';
import type { HaClient } from '../services/ha-client.js';
import type { LightRegistry } from '../services/light-registry.js';
import type { PolicyEngine } from '../services/policy-engine.js';
import { createButtonTools } from './button.js';
import { createClimateTools } from './climate.js';
import { createLightTools } from './lights.js';
import { createNumberTools } from './number.js';
import { createSensorTools } from './sensor.js';
import { createSwitchTools } from './switch.js';

interface CreateToolsDeps {
  registry: LightRegistry;
  policy: PolicyEngine;
  haClient: HaClient;
  auditLogger: AuditLogger;
}

export const createTools = ({ registry, policy, haClient, auditLogger }: CreateToolsDeps) => ({
  ...createLightTools({ registry, policy, haClient, auditLogger }),
  ...createSwitchTools({ registry, policy, haClient, auditLogger }),
  ...createButtonTools({ registry, policy, haClient, auditLogger }),
  ...createNumberTools({ registry, policy, haClient, auditLogger }),
  ...createClimateTools({ registry, policy, haClient, auditLogger }),
  ...createSensorTools({ registry, policy, haClient }),
});
