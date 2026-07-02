import express from 'express';
import type { AuditQuery, LightDevice } from './models/types.js';
import type { auditStore } from './services/audit-store.js';
import type { LightRegistry } from './services/light-registry.js';
import type { createTools } from './tools/index.js';
import type { HaClient } from './services/ha-client.js';
import { HomeAssistantError } from './services/ha-client.js';

type ToolRegistry = ReturnType<typeof createTools>;

interface ServerDeps {
  audit: typeof auditStore;
  registry: LightRegistry;
  tools: ToolRegistry;
  haClient: HaClient;
  mcpRouter?: express.Router;
}

const ok = <T>(data: T) => ({ success: true, data, error: null });
const fail = (error_code: string, message: string, details: Record<string, unknown> = {}) => ({
  success: false,
  data: null,
  error: { error_code, message, details },
});

const failFromError = (fallbackMessage: string, error: unknown) => {
  if (error instanceof HomeAssistantError) {
    return fail(error.code, error.message, { status: error.status });
  }
  return fail('SERVICE_FAILED', fallbackMessage, { message: error instanceof Error ? error.message : String(error) });
};

const toAuditQuery = (query: express.Request['query']): AuditQuery => {
  const { keyword, tool_name, device_name, status, from, to, limit, offset } = query;
  return {
    keyword: typeof keyword === 'string' ? keyword : undefined,
    tool_name: typeof tool_name === 'string' ? tool_name : undefined,
    device_name: typeof device_name === 'string' ? device_name : undefined,
    status: status === 'success' || status === 'failure' ? status : undefined,
    from: typeof from === 'string' ? from : undefined,
    to: typeof to === 'string' ? to : undefined,
    limit: typeof limit === 'string' ? Number(limit) : undefined,
    offset: typeof offset === 'string' ? Number(offset) : undefined,
  };
};

const serializeDevice = (device: LightDevice) => ({
  device_id: device.device_id,
  display_name: device.display_name,
  aliases: device.aliases,
  entity_id: device.entity_id,
  domain: device.domain,
  room: device.room,
  type: device.type,
  state: device.state,
  friendly_name: device.friendly_name,
  supports_brightness: device.supports_brightness,
  supports_value: device.supports_value,
  value_min: device.value_min,
  value_max: device.value_max,
  value_step: device.value_step,
  supported_color_modes: device.supported_color_modes,
  color_mode: device.color_mode,
  brightness: device.brightness,
  supports_temperature: device.supports_temperature,
  supports_hvac_mode: device.supports_hvac_mode,
  supports_fan_mode: device.supports_fan_mode,
  supports_swing_mode: device.supports_swing_mode,
  temperature_min: device.temperature_min,
  temperature_max: device.temperature_max,
  temperature_step: device.temperature_step,
  temperature_unit: device.temperature_unit,
  current_temperature: device.current_temperature,
  target_temperature: device.target_temperature,
  hvac_mode: device.hvac_mode,
  hvac_modes: device.hvac_modes,
  fan_mode: device.fan_mode,
  fan_modes: device.fan_modes,
  swing_mode: device.swing_mode,
  swing_modes: device.swing_modes,
  sensor_unit: device.sensor_unit,
  sensor_value: device.sensor_value,
  capability_source: device.capability_source,
  capabilities: device.capabilities,
  risk_level: device.risk_level,
  enabled: device.enabled,
});

export const createServer = ({ audit, registry, tools, haClient, mcpRouter }: ServerDeps): express.Express => {
  const app = express();

  app.use(express.json());
  if (mcpRouter) app.use('/mcp', mcpRouter);
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  });
  app.options('*', (_req, res) => res.sendStatus(204));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, service: 'mcp-server' });
  });

  app.get('/api/admin/stats/overview', (_req, res) => {
    res.json(ok(audit.summary()));
  });

  app.get('/api/admin/stats/errors', (_req, res) => {
    res.json(ok(audit.failureStats()));
  });

  app.get('/api/admin/logs', (req, res) => {
    res.json(ok(audit.query(toAuditQuery(req.query))));
  });

  app.get('/api/admin/logs/:id', (req, res) => {
    const record = audit.getByRequestId(req.params.id);
    if (!record) {
      res.status(404).json(fail('LOG_NOT_FOUND', '日志不存在', { id: req.params.id }));
      return;
    }
    res.json(ok(record));
  });

  app.get('/api/admin/devices', async (_req, res) => {
    const devices = await registry.listWithHomeAssistantState(haClient);
    res.json(ok({ devices: devices.map(serializeDevice) }));
  });

  app.get('/api/admin/ha/lights/discover', async (_req, res) => {
    try {
      const lights = await haClient.discoverLights();
      res.json(ok({ lights }));
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 500).json(failFromError('发现 Home Assistant 灯光实体失败', error));
    }
  });

  app.get('/api/admin/ha/entities/discover', async (_req, res) => {
    try {
      const entities = await haClient.discoverEntities();
      res.json(ok({ entities }));
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 500).json(failFromError('发现 Home Assistant 设备实体失败', error));
    }
  });

  app.get('/api/control/lights/:entityId/state', async (req, res) => {
    try {
      const result = await tools.get_light_state({ entity_id: req.params.entityId });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 500).json(failFromError('查询灯光状态失败', error));
    }
  });

  app.post('/api/control/lights/resolve', async (req, res) => {
    try {
      const result = await tools.resolve_light({ query: req.body?.query });
      res.json(result);
    } catch (error) {
      res.status(400).json(fail('INVALID_ARGUMENT', '解析灯光名称失败', { message: error instanceof Error ? error.message : String(error) }));
    }
  });

  app.post('/api/control/lights/:entityId/turn-on', async (req, res) => {
    try {
      const result = await tools.turn_on_light({ entity_id: req.params.entityId });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 500).json(failFromError('打开灯光失败', error));
    }
  });

  app.post('/api/control/lights/:entityId/turn-off', async (req, res) => {
    try {
      const result = await tools.turn_off_light({ entity_id: req.params.entityId });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 500).json(failFromError('关闭灯光失败', error));
    }
  });

  app.post('/api/control/lights/:entityId/brightness', async (req, res) => {
    try {
      const result = await tools.set_light_brightness({ entity_id: req.params.entityId, brightness: Number(req.body?.brightness) });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 400).json(failFromError('设置灯光亮度失败', error));
    }
  });

  app.post('/api/control/lights/:entityId/state', async (req, res) => {
    try {
      const result = await tools.set_light_state({
        entity_id: req.params.entityId,
        state: req.body?.state,
        brightness: req.body?.brightness === undefined ? undefined : Number(req.body.brightness),
      });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 400).json(failFromError('设置灯光状态失败', error));
    }
  });

  app.post('/api/control/switches/:entityId/turn-on', async (req, res) => {
    try {
      const result = await tools.turn_on_switch({ entity_id: req.params.entityId });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 500).json(failFromError('打开开关失败', error));
    }
  });

  app.post('/api/control/switches/:entityId/turn-off', async (req, res) => {
    try {
      const result = await tools.turn_off_switch({ entity_id: req.params.entityId });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 500).json(failFromError('关闭开关失败', error));
    }
  });

  app.get('/api/control/switches/:entityId/state', async (req, res) => {
    try {
      const result = await tools.get_switch_state({ entity_id: req.params.entityId });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 500).json(failFromError('查询开关状态失败', error));
    }
  });

  app.post('/api/control/buttons/:entityId/press', async (req, res) => {
    try {
      const result = await tools.press_button({ entity_id: req.params.entityId });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 500).json(failFromError('按下按钮失败', error));
    }
  });

  app.get('/api/control/buttons/:entityId/state', async (req, res) => {
    try {
      const result = await tools.get_button_state({ entity_id: req.params.entityId });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 500).json(failFromError('查询按钮状态失败', error));
    }
  });

  app.post('/api/control/numbers/:entityId/value', async (req, res) => {
    try {
      const result = await tools.set_number_value({ entity_id: req.params.entityId, value: Number(req.body?.value) });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 400).json(failFromError('设置数值失败', error));
    }
  });

  app.get('/api/control/numbers/:entityId/state', async (req, res) => {
    try {
      const result = await tools.get_number_state({ entity_id: req.params.entityId });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 500).json(failFromError('查询数值状态失败', error));
    }
  });

  app.get('/api/control/sensors/:entityId/state', async (req, res) => {
    try {
      const result = await tools.get_sensor_state({ entity_id: req.params.entityId });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 500).json(failFromError('查询传感器状态失败', error));
    }
  });

  app.get('/api/control/climates/:entityId/state', async (req, res) => {
    try {
      const result = await tools.get_climate_state({ entity_id: req.params.entityId });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 500).json(failFromError('查询空调状态失败', error));
    }
  });

  app.post('/api/control/climates/:entityId/temperature', async (req, res) => {
    try {
      const result = await tools.set_climate_temperature({ entity_id: req.params.entityId, temperature: Number(req.body?.temperature) });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 400).json(failFromError('设置空调温度失败', error));
    }
  });

  app.post('/api/control/climates/:entityId/hvac-mode', async (req, res) => {
    try {
      const result = await tools.set_climate_hvac_mode({ entity_id: req.params.entityId, hvac_mode: req.body?.hvac_mode });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 400).json(failFromError('设置空调模式失败', error));
    }
  });

  app.post('/api/control/climates/:entityId/fan-mode', async (req, res) => {
    try {
      const result = await tools.set_climate_fan_mode({ entity_id: req.params.entityId, fan_mode: req.body?.fan_mode });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 400).json(failFromError('设置空调风扇模式失败', error));
    }
  });

  app.post('/api/control/climates/:entityId/swing-mode', async (req, res) => {
    try {
      const result = await tools.set_climate_swing_mode({ entity_id: req.params.entityId, swing_mode: req.body?.swing_mode });
      res.json(result);
    } catch (error) {
      res.status(error instanceof HomeAssistantError && error.code === 'AUTH_FAILED' ? 401 : 400).json(failFromError('设置空调摆风模式失败', error));
    }
  });

  return app;
};

export const startServer = (deps: ServerDeps, port = Number(process.env.ADMIN_WEB_PORT ?? 4000)) => {
  const app = createServer(deps);
  app.listen(port, () => {
    console.log(`admin api listening on ${port}`);
  });
};
