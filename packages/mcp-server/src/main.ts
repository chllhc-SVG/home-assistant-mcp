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

const seedToolByDomain = {
  light: 'get_light_state',
  switch: 'get_switch_state',
  button: 'get_button_state',
  number: 'get_number_state',
  climate: 'get_climate_state',
  sensor: 'get_sensor_state',
} as const;

const seedEvents = config.lights.map((device, index) => ({
  id: `seed_${index + 1}`,
  request_id: `seed_req_${index + 1}`,
  timestamp: new Date().toISOString(),
  source: 'web' as const,
  tool_name: seedToolByDomain[device.domain],
  user_input: 'seed',
  intent: 'seed',
  resolved_device: { display_name: device.display_name, entity_id: device.entity_id },
  tool_args: { entity_id: device.entity_id },
  result: { success: true, state_after: device.state ?? 'unknown' },
  duration_ms: 120,
  device_id: device.device_id,
  entity_id: device.entity_id,
  result_status: 'success' as const,
}));

auditStore.seed(seedEvents);

export const tools = createTools({ registry, policy, haClient, auditLogger });
export { auditStore };

if (process.env.NODE_ENV !== 'test') {
  startServer({ audit: auditStore, registry, tools, haClient }, Number(process.env.ADMIN_WEB_PORT ?? 4000));
  console.log('MCP server skeleton loaded');
}
