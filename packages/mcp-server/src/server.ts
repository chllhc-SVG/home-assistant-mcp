import express from 'express';
import type { AuditQuery, DeviceExposureConfig, LightDevice } from './models/types.js';
import type { auditStore } from './services/audit-store.js';
import type { LightRegistry } from './services/light-registry.js';
import type { createTools } from './tools/index.js';
import type { HaClient } from './services/ha-client.js';
import { HomeAssistantError } from './services/ha-client.js';
import { WhitelistStore } from './services/whitelist-store.js';

type ToolRegistry = ReturnType<typeof createTools>;

interface ServerDeps {
  audit: typeof auditStore;
  registry: LightRegistry;
  tools: ToolRegistry;
  haClient: HaClient;
  whitelistStore: WhitelistStore;
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
  color_temp_min_kelvin: device.color_temp_min_kelvin,
  color_temp_max_kelvin: device.color_temp_max_kelvin,
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

export const createServer = ({ audit, registry, tools, haClient, whitelistStore, mcpRouter }: ServerDeps): express.Express => {
  const app = express();

  app.use(express.json());
  if (mcpRouter) app.use('/mcp', mcpRouter);
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  });
  app.options('*', (_req, res) => res.sendStatus(204));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, service: 'mcp-server' });
  });

  app.get('/api/admin/stats/overview', async (_req, res) => {
    res.json(ok(await audit.summary()));
  });

  app.get('/api/admin/stats/errors', async (_req, res) => {
    res.json(ok(await audit.failureStats()));
  });

  app.get('/api/admin/logs', async (req, res) => {
    res.json(ok(await audit.query(toAuditQuery(req.query))));
  });

  app.get('/api/admin/logs/:id', async (req, res) => {
    const record = await audit.getByRequestId(req.params.id);
    if (!record) {
      res.status(404).json(fail('LOG_NOT_FOUND', '日志不存在', { id: req.params.id }));
      return;
    }
    res.json(ok(record));
  });

  app.delete('/api/admin/logs/:id', async (req, res) => {
    const deleted = await audit.deleteById(req.params.id);
    if (!deleted) {
      res.status(404).json(fail('LOG_NOT_FOUND', '日志不存在', { id: req.params.id }));
      return;
    }
    res.json(ok({ deleted: true }));
  });

  app.post('/api/admin/logs/batch-delete', async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id): id is string => typeof id === 'string') : [];
    const deleted = await audit.deleteMany(ids);
    res.json(ok({ deleted }));
  });

  app.get('/api/admin/devices', async (_req, res) => {
    try {
      const records = (await whitelistStore.list()).filter((record) => record.enabled);
      const enabledEntityIds = records.map((record) => record.entity_id);
      registry.setExposure(enabledEntityIds);

      const discovered = await haClient.discoverEntities();
      const discoveredByEntityId = new Map(discovered.map((device) => [device.entity_id, device]));

      for (const record of records) {
        const snapshot = discoveredByEntityId.get(record.entity_id);
        const domain = (snapshot?.domain ?? record.domain ?? record.entity_id.split('.')[0]) as LightDevice['domain'];
        registry.upsert({
          device_id: snapshot?.device_id ?? record.device_id ?? record.entity_id,
          display_name: snapshot?.device_name ?? snapshot?.friendly_name ?? record.display_name ?? record.entity_id,
          aliases: [],
          entity_id: record.entity_id,
          domain,
          room: snapshot?.area_name ?? record.area_name ?? record.room ?? '',
          area_id: snapshot?.area_id ?? record.area_id,
          area_name: snapshot?.area_name ?? record.area_name,
          type: domain,
          state: snapshot?.state,
          friendly_name: snapshot?.friendly_name ?? record.friendly_name,
          supports_brightness: snapshot?.supports_brightness ?? false,
          supports_value: snapshot?.supports_value,
          supports_temperature: snapshot?.supports_temperature,
          supports_hvac_mode: snapshot?.supports_hvac_mode,
          supports_fan_mode: snapshot?.supports_fan_mode,
          supports_swing_mode: snapshot?.supports_swing_mode,
          value_min: snapshot?.value_min,
          value_max: snapshot?.value_max,
          value_step: snapshot?.value_step,
          temperature_min: snapshot?.temperature_min,
          temperature_max: snapshot?.temperature_max,
          temperature_step: snapshot?.temperature_step,
          temperature_unit: snapshot?.temperature_unit,
          current_temperature: snapshot?.current_temperature,
          target_temperature: snapshot?.target_temperature,
          hvac_mode: snapshot?.hvac_mode,
          hvac_modes: snapshot?.hvac_modes,
          fan_mode: snapshot?.fan_mode,
          fan_modes: snapshot?.fan_modes,
          swing_mode: snapshot?.swing_mode,
          swing_modes: snapshot?.swing_modes,
          sensor_unit: snapshot?.sensor_unit,
          sensor_value: snapshot?.sensor_value,
          supported_color_modes: snapshot?.supported_color_modes,
          color_mode: snapshot?.color_mode,
          brightness: snapshot?.brightness,
          capabilities: [],
          risk_level: 'low',
          enabled: true,
        });
      }

      const devices = registry.list({ enabledOnly: true }).filter((device) => enabledEntityIds.includes(device.entity_id));
      res.json(ok({ devices: devices.map(serializeDevice) }));
    } catch (error) {
      res.status(500).json(failFromError('读取具体设备控制列表失败', error));
    }
  });

  app.get('/api/admin/device-exposure', async (_req, res) => {
    try {
      const records = await whitelistStore.list();
      registry.setExposure(records.filter((record) => record.enabled).map((record) => record.entity_id));
      res.json(ok({
        exposure: records.filter((record) => record.enabled).map((record) => record.entity_id),
        records,
      }));
    } catch (error) {
      res.status(500).json(failFromError('读取白名单数据库失败', error));
    }
  });

  app.post('/api/admin/device-exposure', async (req, res) => {
    try {
      const payload = req.body as DeviceExposureConfig;
      const selectedEntityIds = Array.isArray(payload.devices)
        ? payload.devices.filter((entityId): entityId is string => typeof entityId === 'string' && entityId.trim().length > 0)
        : [];
      const action = req.body?.action === 'delete' ? 'delete' : 'upsert';

      if (action === 'delete') {
        await whitelistStore.delete(selectedEntityIds);
      } else {
        const existingRecords = await whitelistStore.list();
        const existingEntityIds = existingRecords.map((record) => record.entity_id);
        const entityIdsToDelete = existingEntityIds.filter((entityId) => !selectedEntityIds.includes(entityId));
        if (entityIdsToDelete.length > 0) {
          await whitelistStore.delete(entityIdsToDelete);
        }

        const discovered = await haClient.discoverEntities();
        const discoveredByEntityId = new Map(discovered.map((device) => [device.entity_id, device]));
        const records = selectedEntityIds.map((entityId) => {
          const snapshot = discoveredByEntityId.get(entityId);
          const domain = (snapshot?.domain ?? entityId.split('.')[0]) as LightDevice['domain'];
          return {
            entity_id: entityId,
            display_name: snapshot?.device_name ?? snapshot?.friendly_name ?? entityId,
            friendly_name: snapshot?.friendly_name,
            device_id: snapshot?.device_id ?? entityId,
            device_name: snapshot?.device_name,
            domain,
            room: snapshot?.area_name ?? '',
            area_id: snapshot?.area_id,
            area_name: snapshot?.area_name,
            enabled: true,
          };
        });
        await whitelistStore.upsert(records);
      }

      const records = await whitelistStore.list();
      registry.setExposure(records.filter((record) => record.enabled).map((record) => record.entity_id));
      res.json(ok({ saved: true, devices: records.filter((record) => record.enabled).map((record) => record.entity_id) }));
    } catch (error) {
      res.status(400).json(failFromError('保存设备暴露配置失败', error));
    }
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
        color_temp_kelvin: req.body?.color_temp_kelvin === undefined ? undefined : Number(req.body.color_temp_kelvin),
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
