import 'dotenv/config';
import { auditStore } from './services/audit-store.js';
import { createServer as createHttpServer } from './server.js';
import { createRuntime } from './runtime.js';
import { startMcp } from './mcp.js';
import { createMcpHttpRouter } from './mcp-http.js';

const runtime = createRuntime();

const boot = async () => {
  await auditStore.seed(runtime.seedEvents);

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
    mcpRouter: createMcpHttpRouter(runtime),
  });
  mcpApp.listen(mcpPort, () => {
    console.log(`mcp http listening on ${mcpPort}/mcp`);
  });
};

if (process.env.NODE_ENV !== 'test') {
  void boot();
}

export const tools = runtime.tools;
