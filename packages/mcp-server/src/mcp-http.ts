import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Runtime } from './runtime.js';
import { dispatchTool } from './mcp.js';

const protocolVersion = '2024-11-05';

const tools = [
  {
    name: 'resolve_device',
    description: 'Resolve a natural language device query to matching device candidates.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        domain: { type: 'string' },
        room: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_devices',
    description: 'List controllable devices.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        room: { type: 'string' },
        keyword: { type: 'string' },
        enabled_only: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_device_state',
    description: 'Get the current state of a device.',
    inputSchema: {
      type: 'object',
      properties: { entity_id: { type: 'string' } },
      required: ['entity_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'control_device',
    description: 'Control a device with a unified action model.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string' },
        action: { type: 'string', enum: ['turn_on', 'turn_off', 'press', 'set_brightness', 'set_value', 'set_temperature', 'set_hvac_mode', 'set_fan_mode', 'set_swing_mode'] },
        brightness: { type: 'number' },
        value: { type: 'number' },
        temperature: { type: 'number' },
        hvac_mode: { type: 'string' },
        fan_mode: { type: 'string' },
        swing_mode: { type: 'string' },
      },
      required: ['entity_id', 'action'],
      additionalProperties: false,
    },
  },
];

const sessions = new Map<string, Response>();

const sendJson = (res: Response, body: unknown) => res.json({ success: true, data: body, error: null });

const sseWrite = (res: Response, event: string, payload: unknown) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const sendError = (res: Response, status: number, error_code: string, message: string, details: Record<string, unknown> = {}) => {
  res.status(status).json({ success: false, data: null, error: { error_code, message, details } });
};

export const createMcpHttpRouter = (runtime: Runtime): express.Router => {
  const router = express.Router();

  router.get('/healthz', (_req, res) => sendJson(res, { ok: true, service: 'mcp-http' }));
  router.get('/tools', (_req, res) => sendJson(res, tools));

  router.get('/', (req: Request, res: Response) => {
    const sessionId = randomUUID();
    sessions.set(sessionId, res);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Mcp-Session-Id', sessionId);
    sseWrite(res, 'endpoint', { url: `/mcp/messages?session_id=${sessionId}` });
    sseWrite(res, 'message', {
      jsonrpc: '2.0',
      id: null,
      result: {
        protocolVersion,
        serverInfo: { name: 'home-assistant-mcp', version: '1.0.0' },
        capabilities: { tools: {} },
      },
    });
    req.on('close', () => sessions.delete(sessionId));
  });

  router.post('/messages', async (req: Request, res: Response) => {
    try {
      const { method, id, params } = req.body ?? {};
      if (method === 'initialize') {
        res.json({ jsonrpc: '2.0', id: id ?? null, result: { protocolVersion, serverInfo: { name: 'home-assistant-mcp', version: '1.0.0' }, capabilities: { tools: {} } } });
        return;
      }
      if (method === 'tools/list') {
        res.json({ jsonrpc: '2.0', id: id ?? null, result: { tools } });
        return;
      }
      if (method === 'tools/call') {
        const name = typeof params?.name === 'string' ? params.name : undefined;
        if (!name) {
          sendError(res, 400, 'INVALID_ARGUMENT', 'Missing tool name');
          return;
        }
        const result = await dispatchTool(runtime, name, params?.arguments);
        res.json({ jsonrpc: '2.0', id: id ?? null, result });
        return;
      }
      sendError(res, 404, 'INVALID_ARGUMENT', `Unknown method: ${String(method)}`);
    } catch (error) {
      sendError(res, 500, 'SERVICE_FAILED', 'HTTP MCP execution failed', { message: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
};
