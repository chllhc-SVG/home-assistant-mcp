import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Runtime } from './runtime.js';
import { dispatchTool, mcpTools } from './mcp.js';
import {
  controlDeviceInputSchema,
  listClimateDevicesInputSchema,
  listDevicesInputSchema,
  setClimateFanModeInputSchema,
  setClimateHvacModeInputSchema,
  setClimateSwingModeInputSchema,
  setClimateTemperatureInputSchema,
} from './models/schemas.js';

type TraceEvent = {
  id: string;
  timestamp: string;
  transport: 'streamable-http' | 'sse' | 'debug';
  method: string;
  toolName?: string;
  ok: boolean;
  error?: string;
};

const traceEvents: TraceEvent[] = [];
const sseSessions = new Map<string, Response>();

const trace = (event: Omit<TraceEvent, 'id' | 'timestamp'>) => {
  traceEvents.unshift({ id: randomUUID(), timestamp: new Date().toISOString(), ...event });
  traceEvents.splice(100);
};

const registerTools = (server: McpServer, runtime: Runtime) => {
  server.tool(
    'list_devices',
    'List all controllable Home Assistant devices. Use this to discover entity_id values before controlling lights, switches, climate devices, buttons, numbers, or sensors.',
    listDevicesInputSchema.shape,
    async (input) => dispatchTool(runtime, 'list_devices', input),
  );

  server.tool(
    'control_device',
    'Control a Home Assistant device. Use registry/whitelist lookups first and prefer exact entity or device name matches. Use switch controls for main lights, downlights, and light strips. Use climate controls for temperature. Only use set_all_lights_state when the user explicitly asks to control all lights or all switches explicitly.',
    controlDeviceInputSchema.shape,
    async (input) => dispatchTool(runtime, 'control_device', input),
  );

  server.tool(
    'set_all_lights_state',
    '批量控制所有灯光或所有开关。仅用于明确请求全部设备的统一开关控制时，不要用于单个主灯、筒灯或灯带。',
    z.object({
      state: z.enum(['on', 'off']),
      room: z.string().optional(),
    }).shape,
    {
      title: 'set_all_lights_state',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async (input) => dispatchTool(runtime, 'set_all_lights_state', input),
  );

  server.tool(
    'list_climate_devices',
    'List controllable climate / air conditioner devices. Use this before setting air conditioner temperature when the entity_id is unknown.',
    listClimateDevicesInputSchema.shape,
    async (input) => dispatchTool(runtime, 'list_climate_devices', input),
  );

  server.tool(
    'set_climate_temperature',
    'Set an air conditioner / climate device target temperature. Use this when the user asks to set AC temperature, for example set the air conditioner to 21 degrees.',
    setClimateTemperatureInputSchema.shape,
    async (input) => dispatchTool(runtime, 'set_climate_temperature', input),
  );

  server.tool(
    'set_climate_hvac_mode',
    'Set an air conditioner / climate device HVAC mode, such as cool, heat, auto, dry, fan_only, or off.',
    setClimateHvacModeInputSchema.shape,
    async (input) => dispatchTool(runtime, 'set_climate_hvac_mode', input),
  );

  server.tool(
    'set_climate_fan_mode',
    'Set an air conditioner / climate device fan mode.',
    setClimateFanModeInputSchema.shape,
    async (input) => dispatchTool(runtime, 'set_climate_fan_mode', input),
  );

  server.tool(
    'set_climate_swing_mode',
    'Set an air conditioner / climate device swing mode.',
    setClimateSwingModeInputSchema.shape,
    async (input) => dispatchTool(runtime, 'set_climate_swing_mode', input),
  );
};

const createServer = (runtime: Runtime) => {
  const server = new McpServer({
    name: 'home-assistant-mcp',
    version: '1.0.0',
  });

  registerTools(server, runtime);
  return server;
};

const sendSse = (res: Response, event: string, data: unknown) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const jsonRpcResult = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const jsonRpcError = (id: unknown, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});

const handleLegacyJsonRpc = async (runtime: Runtime, body: Record<string, unknown>) => {
  const method = typeof body.method === 'string' ? body.method : '';
  const id = body.id;
  const params = body.params && typeof body.params === 'object' ? body.params as Record<string, unknown> : {};

  try {
    if (method === 'initialize') {
      trace({ transport: 'sse', method, ok: true });
      return jsonRpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'home-assistant-mcp', version: '1.0.0' },
      });
    }

    if (method === 'notifications/initialized') {
      trace({ transport: 'sse', method, ok: true });
      return undefined;
    }

    if (method === 'tools/list') {
      trace({ transport: 'sse', method, ok: true });
      return jsonRpcResult(id, { tools: mcpTools });
    }

    if (method === 'tools/call') {
      const toolName = typeof params.name === 'string' ? params.name : undefined;
      if (!toolName) return jsonRpcError(id, -32602, 'Missing tool name');
      const result = await dispatchTool(runtime, toolName, params.arguments);
      trace({ transport: 'sse', method, toolName, ok: true });
      return jsonRpcResult(id, result);
    }

    if (method === 'ping') {
      trace({ transport: 'sse', method, ok: true });
      return jsonRpcResult(id, {});
    }

    trace({ transport: 'sse', method, ok: false, error: 'method_not_found' });
    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    trace({ transport: 'sse', method, ok: false, error: error instanceof Error ? error.message : String(error) });
    return jsonRpcError(id, -32603, 'MCP request failed', { message: error instanceof Error ? error.message : String(error) });
  }
};

export const createMcpHttpRouter = (runtime: Runtime): express.Router => {
  const router = express.Router();

  router.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id, MCP-Protocol-Version');
    res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  router.get('/healthz', (_req, res) => {
    res.json({
      success: true,
      data: {
        ok: true,
        service: 'mcp-http',
        transports: ['streamable-http', 'legacy-sse'],
        endpoint: '/mcp',
      },
      error: null,
    });
  });

  router.get('/debug', (_req, res) => {
    res.json({ success: true, data: { recent: traceEvents }, error: null });
  });

  router.post('/', async (req: Request, res: Response) => {
    const method = typeof req.body?.method === 'string' ? req.body.method : 'unknown';
    const toolName = typeof req.body?.params?.name === 'string' ? req.body.params.name : undefined;
    const server = createServer(runtime);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    try {
      res.on('close', () => {
        void transport.close();
        void server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      trace({ transport: 'streamable-http', method, toolName, ok: true });
    } catch (error) {
      trace({ transport: 'streamable-http', method, toolName, ok: false, error: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) {
        res.status(500).json(jsonRpcError(req.body?.id, -32603, 'Streamable HTTP MCP request failed', { message: error instanceof Error ? error.message : String(error) }));
      }
    }
  });

  router.get('/', (req: Request, res: Response) => {
    const sessionId = randomUUID();
    sseSessions.set(sessionId, res);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Mcp-Session-Id', sessionId);

    sendSse(res, 'endpoint', { url: `/mcp/messages?session_id=${sessionId}` });
    sendSse(res, 'message', jsonRpcResult(null, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: 'home-assistant-mcp', version: '1.0.0' },
    }));
    trace({ transport: 'sse', method: 'connect', ok: true });

    req.on('close', () => {
      sseSessions.delete(sessionId);
    });
  });

  router.post('/messages', async (req: Request, res: Response) => {
    const response = await handleLegacyJsonRpc(runtime, req.body ?? {});
    if (!response) {
      res.status(202).end();
      return;
    }
    res.json(response);
  });

  router.delete('/', (_req, res) => {
    res.status(202).end();
  });

  return router;
};
