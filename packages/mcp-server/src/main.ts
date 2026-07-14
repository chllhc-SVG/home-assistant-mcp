import 'dotenv/config';
import { auditStore } from './services/audit-store.js';
import { createServer as createHttpServer } from './server.js';
import { createRuntime } from './runtime.js';
import { startMcp, warmMcpDiscoveryCache } from './mcp.js';
import { createMcpHttpRouter } from './mcp-http.js';
import { syncDeviceRegistryFromHomeAssistant } from './services/device-registry-sync.js';

const boot = async () => {
  const runtime = await createRuntime();
  await auditStore.seed(runtime.seedEvents);

  let syncInFlight = false;
  const syncHaRegistry = async () => {
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      const result = await syncDeviceRegistryFromHomeAssistant(runtime);
      console.log(`ha device registry synced at ${result.synced_at}`);
    } catch (error) {
      console.error('ha device registry sync failed; using the last local snapshot', error);
    } finally {
      syncInFlight = false;
    }
  };
  void warmMcpDiscoveryCache(runtime)
    .then((count) => console.log(`mcp discovery cache warmed with ${count} entities`))
    .catch((error) => console.error('mcp discovery cache warm failed; will use registry fallback', error));
  void syncHaRegistry();
  const syncTimer = setInterval(() => void syncHaRegistry(), runtime.config.haRegistrySyncIntervalMs);
  syncTimer.unref();

  const mcpMode = process.env.MCP_MODE ?? 'http';

  if (mcpMode === 'stdio') {
    startMcp(runtime);
    return;
  }

  const adminPort = Number(process.env.ADMIN_WEB_PORT ?? 4000);
  const adminApp = createHttpServer({
    audit: auditStore,
    registry: runtime.registry,
    tools: runtime.tools,
    haClient: runtime.haClient,
    whitelistStore: runtime.whitelistStore,
  });
  adminApp.listen(adminPort, () => {
    console.log(`admin api listening on ${adminPort}`);
  });

  const mcpPort = Number(process.env.MCP_HTTP_PORT ?? 4010);
  const mcpApp = createHttpServer({
    audit: auditStore,
    registry: runtime.registry,
    tools: runtime.tools,
    haClient: runtime.haClient,
    whitelistStore: runtime.whitelistStore,
    mcpRouter: createMcpHttpRouter(runtime),
  });
  mcpApp.listen(mcpPort, () => {
    console.log(`mcp http listening on ${mcpPort}/mcp`);
  });
};

if (process.env.NODE_ENV !== 'test') {
  void boot();
}

export let tools: ReturnType<typeof import('./tools/index.js').createTools>;
