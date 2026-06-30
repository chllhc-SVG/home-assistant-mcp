import { loadConfig } from './config.js';
import { auditStore } from './services/audit-store.js';
import { AuditLogger } from './services/audit-logger.js';
import { HaClient } from './services/ha-client.js';
import { LightRegistry } from './services/light-registry.js';
import { PolicyEngine } from './services/policy-engine.js';
import { createTools } from './tools/index.js';
import { startServer } from './server.js';

const config = loadConfig();
export const registry = new LightRegistry(config.lights);
const policy = new PolicyEngine();
export const haClient = new HaClient(config.homeAssistantBaseUrl, config.homeAssistantToken, config.timeoutMs);
const auditLogger = new AuditLogger(auditStore);

const seedEvents = config.lights.map((light, index) => ({
  id: `seed_${index + 1}`,
  request_id: `seed_req_${index + 1}`,
  timestamp: new Date().toISOString(),
  source: 'web' as const,
  tool_name: 'turn_on_light',
  user_input: 'seed',
  intent: 'seed',
  resolved_device: { display_name: light.display_name, entity_id: light.entity_id },
  tool_args: { entity_id: light.entity_id },
  result: { success: true, state_after: 'on' },
  duration_ms: 120,
  device_id: light.device_id,
  entity_id: light.entity_id,
  result_status: 'success' as const,
}));

auditStore.seed(seedEvents);

export const tools = createTools({ registry, policy, haClient, auditLogger });
export { auditStore };

if (process.env.NODE_ENV !== 'test') {
  startServer({ audit: auditStore, registry, tools, haClient }, Number(process.env.ADMIN_WEB_PORT ?? 4000));
  console.log('MCP server skeleton loaded');
}
