import type { AuditLogger } from '../services/audit-logger.js';
import type { HaClient } from '../services/ha-client.js';
import type { LightRegistry } from '../services/light-registry.js';
import type { PolicyEngine } from '../services/policy-engine.js';
import { createLightTools } from './lights.js';

interface CreateToolsDeps {
  registry: LightRegistry;
  policy: PolicyEngine;
  haClient: HaClient;
  auditLogger: AuditLogger;
}

export const createTools = ({ registry, policy, haClient, auditLogger }: CreateToolsDeps) => {
  return createLightTools({ registry, policy, haClient, auditLogger });
};
