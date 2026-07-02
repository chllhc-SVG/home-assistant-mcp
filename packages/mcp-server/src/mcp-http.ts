import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Runtime } from './runtime.js';
import { dispatchTool } from './mcp.js';
import {
  controlDeviceInputSchema,
  getDeviceStateInputSchema,
  listDevicesInputSchema,
  resolveDeviceInputSchema,
} from './models/schemas.js';

const createServer = (runtime: Runtime) => {
  const server = new McpServer({
    name: 'home-assistant-mcp',
    version: '1.0.0',
  });

  server.tool(
    'resolve_device',
    'Resolve a natural language device query to matching device candidates.',
    resolveDeviceInputSchema.shape,
    async (input) => dispatchTool(runtime, 'resolve_device', input),
  );

  server.tool(
    'list_devices',
    'List controllable devices.',
    listDevicesInputSchema.shape,
    async (input) => dispatchTool(runtime, 'list_devices', input),
  );

  server.tool(
    'get_device_state',
    'Get the current state of a device.',
    getDeviceStateInputSchema.shape,
    async (input) => dispatchTool(runtime, 'get_device_state', input),
  );

  server.tool(
    'control_device',
    'Control a device with a unified action model.',
    controlDeviceInputSchema.shape,
    async (input) => dispatchTool(runtime, 'control_device', input),
  );

  return server;
};

export const createMcpHttpRouter = (runtime: Runtime): express.Router => {
  const router = express.Router();

  router.get('/healthz', (_req, res) => {
    res.json({ success: true, data: { ok: true, service: 'mcp-streamable-http' }, error: null });
  });

  router.post('/', async (req: Request, res: Response) => {
    const server = createServer(runtime);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  router.get('/', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed. Use POST /mcp for Streamable HTTP MCP requests.',
      },
      id: null,
    });
  });

  router.delete('/', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed for stateless Streamable HTTP transport.',
      },
      id: null,
    });
  });

  return router;
};
