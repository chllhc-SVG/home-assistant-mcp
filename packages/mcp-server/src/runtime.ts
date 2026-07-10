import type { LightDevice } from './models/types.js';
import { loadConfig } from './config.js';
import { auditStore } from './services/audit-store.js';
import { AuditLogger } from './services/audit-logger.js';
import { HaClient } from './services/ha-client.js';
import { LightRegistry } from './services/light-registry.js';
import { PolicyEngine } from './services/policy-engine.js';
import { createTools } from './tools/index.js';
import { WhitelistStore } from './services/whitelist-store.js';
import { hydrateRegistryFromWhitelist } from './services/device-registry-sync.js';

const seedToolByDomain: Record<LightDevice['domain'], string> = {
  light: 'get_light_state',
  switch: 'get_switch_state',
  button: 'get_button_state',
  number: 'get_number_state',
  climate: 'get_climate_state',
  sensor: 'get_sensor_state',
};

export const createSeedEvents = (lights: LightDevice[]) =>
  lights.map((device, index) => ({
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

export interface Runtime {
  config: ReturnType<typeof loadConfig>;
  registry: LightRegistry;
  policy: PolicyEngine;
  haClient: HaClient;
  auditLogger: AuditLogger;
  tools: ReturnType<typeof createTools>;
  whitelistStore: WhitelistStore;
  seedEvents: ReturnType<typeof createSeedEvents>;
}

export const createRuntime = async (): Promise<Runtime> => {
  const config = loadConfig();
  const whitelistStore = new WhitelistStore(config.databaseUrl);
  await whitelistStore.initialize();

  const registry = new LightRegistry([]);
  const policy = new PolicyEngine();
  const haClient = new HaClient(config.homeAssistantBaseUrl, config.homeAssistantToken, config.timeoutMs);
  const auditLogger = new AuditLogger(auditStore);
  const tools = createTools({ registry, policy, haClient, auditLogger, roomControlProfiles: config.roomControlProfiles });

  const records = await whitelistStore.list();
  hydrateRegistryFromWhitelist(registry, records);

  return {
    config,
    registry,
    policy,
    haClient,
    auditLogger,
    tools,
    whitelistStore,
    seedEvents: [],
  };
};
