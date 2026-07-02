import express, { type Request, type Response } from 'express';
import type { Runtime } from './runtime.js';
import { dispatchTool, type JsonRpcResponse } from './mcp.js';

const sendJson = (res: Response, body: unknown) => res.json({ success: true, data: body, error: null });

const writeStreamEvent = (res: Response, event: string, payload: unknown) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

export const createMcpHttpRouter = (runtime: Runtime): express.Router => {
  const router = express.Router();

  router.get('/healthz', (_req, res) => {
    sendJson(res, { ok: true, service: 'mcp-http' });
  });

  router.get('/tools', (_req, res) => {
    sendJson(res, [
      'resolve_device',
      'list_devices',
      'get_device_state',
      'control_device',
    ]);
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const { method, id, params } = req.body ?? {};
      if (method === 'initialize') {
        const payload: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'home-assistant-mcp', version: '1.0.0' },
            capabilities: { tools: {} },
          },
        };
        res.json(payload);
        return;
      }

      if (method === 'tools/list') {
        const payload: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {
            tools: [
              { name: 'resolve_device' },
              { name: 'list_devices' },
              { name: 'get_device_state' },
              { name: 'control_device' },
            ],
          },
        };
        res.json(payload);
        return;
      }

      if (method === 'tools/call') {
        const name = typeof params?.name === 'string' ? params.name : undefined;
        if (!name) {
          res.status(400).json({ success: false, data: null, error: { error_code: 'INVALID_ARGUMENT', message: 'Missing tool name', details: {} } });
          return;
        }

        const result = await dispatchTool(runtime, name, params?.arguments);
        const payload: JsonRpcResponse = { jsonrpc: '2.0', id: id ?? null, result };
        if (req.headers.accept?.includes('text/event-stream')) {
          res.status(200);
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          writeStreamEvent(res, 'message', payload);
          res.end();
          return;
        }
        res.json(payload);
        return;
      }

      res.status(404).json({ success: false, data: null, error: { error_code: 'INVALID_ARGUMENT', message: `Unknown method: ${String(method)}`, details: {} } });
    } catch (error) {
      res.status(500).json({
        success: false,
        data: null,
        error: {
          error_code: 'SERVICE_FAILED',
          message: 'HTTP MCP execution failed',
          details: { message: error instanceof Error ? error.message : String(error) },
        },
      });
    }
  });

  return router;
};
