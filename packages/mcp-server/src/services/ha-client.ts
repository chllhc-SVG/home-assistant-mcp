import WebSocket, { type RawData } from 'ws';
import type { HaAreaInfo, HaDeviceInfo, HaEntityRegistryEntry } from '../models/types.js';
import { extractEntityCapabilitySnapshot } from './device-capabilities.js';

type WsResultMessage<T> = {
  id: number;
  type: 'result';
  success: boolean;
  result?: T;
  error?: { code: string; message: string };
};

export class HomeAssistantError extends Error {
  constructor(
    public readonly code: 'AUTH_FAILED' | 'TIMEOUT' | 'SERVICE_FAILED',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'HomeAssistantError';
  }
}

export class HaClient {
  private entityDiscoveryCache = new Map<string, { expiresAt: number; value: ReturnType<HaClient['discoverEntitiesWithoutCache']> extends Promise<infer T> ? T : never }>();
  private entityDiscoveryInFlight = new Map<string, Promise<ReturnType<HaClient['discoverEntitiesWithoutCache']> extends Promise<infer T> ? T : never>>();

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 15000,
  ) {}

  private getWebSocketUrl() {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/api/websocket';
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.token) {
      throw new HomeAssistantError('AUTH_FAILED', 'Home Assistant token is empty. 请设置 HOME_ASSISTANT_TOKEN 或 HA_TOKEN。');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });

      if (response.status === 401 || response.status === 403) {
        throw new HomeAssistantError('AUTH_FAILED', `Home Assistant authentication failed: ${response.status}`, response.status);
      }

      if (response.status === 408 || response.status === 504) {
        throw new HomeAssistantError('TIMEOUT', `Home Assistant service timed out: ${response.status}. 请求已到达 Home Assistant，但设备或集成响应超时。`, response.status);
      }

      if (!response.ok) {
        throw new HomeAssistantError('SERVICE_FAILED', `Home Assistant API error: ${response.status}`, response.status);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof HomeAssistantError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HomeAssistantError('TIMEOUT', `Home Assistant request timed out after ${this.timeoutMs}ms`);
      }
      throw new HomeAssistantError('SERVICE_FAILED', error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  getState(entityId: string) {
    return this.request<Record<string, unknown>>(`/api/states/${entityId}`, { method: 'GET' });
  }

  listStates() {
    return this.request<Array<Record<string, unknown>>>('/api/states', { method: 'GET' });
  }

  listEntityRegistry() {
    return this.request<HaEntityRegistryEntry[]>('/api/entity_registry/list', { method: 'GET' });
  }

  listDeviceRegistry() {
    return this.request<HaDeviceInfo[]>('/api/device_registry/list', { method: 'GET' });
  }

  listAreas() {
    return this.request<HaAreaInfo[]>('/api/areas', { method: 'GET' });
  }

  private async wsBatchRequest(commands: Array<{ id: number; type: string; payload?: Record<string, unknown> }>) {
    if (!this.token) {
      throw new HomeAssistantError('AUTH_FAILED', 'Home Assistant token is empty. 请设置 HOME_ASSISTANT_TOKEN 或 HA_TOKEN。');
    }

    const ws = new WebSocket(this.getWebSocketUrl());
    const readMessageText = async (data: RawData) => {
      if (typeof data === 'string') return data;
      if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
      if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
      if (Array.isArray(data)) return new TextDecoder().decode(Buffer.concat(data));
      return String(data);
    };

    console.log('[ha-ws] connect', { commands: commands.map((command) => command.type), url: this.getWebSocketUrl() });

    return await new Promise<Map<number, WsResultMessage<unknown>>>((resolve, reject) => {
      let settled = false;
      const results = new Map<number, WsResultMessage<unknown>>();
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback();
      };
      const timeout = setTimeout(() => {
        console.log('[ha-ws] timeout', { commands: commands.map((command) => command.type), timeoutMs: this.timeoutMs });
        ws.close();
        settle(() => reject(new HomeAssistantError('TIMEOUT', `Home Assistant websocket request timed out after ${this.timeoutMs}ms`)));
      }, this.timeoutMs);

      ws.addEventListener('error', () => {
        console.log('[ha-ws] error', { commands: commands.map((command) => command.type) });
        settle(() => reject(new HomeAssistantError('SERVICE_FAILED', 'Home Assistant websocket connection failed')));
      });

      ws.addEventListener('message', async (event: { data: RawData }) => {
        try {
          const text = await readMessageText(event.data);
          const msg = JSON.parse(text) as Record<string, unknown>;
          if (msg.type === 'auth_required') {
            ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
            return;
          }
          if (msg.type === 'auth_invalid') {
            ws.close();
            console.log('[ha-ws] auth_invalid', { message: msg.message });
            settle(() => reject(new HomeAssistantError('AUTH_FAILED', typeof msg.message === 'string' ? msg.message : 'Home Assistant websocket auth failed')));
            return;
          }
          if (msg.type === 'auth_ok') {
            console.log('[ha-ws] auth_ok', { commands: commands.map((command) => command.type) });
            for (const command of commands) {
              ws.send(JSON.stringify({ id: command.id, type: command.type, ...(command.payload ?? {}) }));
            }
            return;
          }
          if (msg.type === 'result') {
            const result = msg as WsResultMessage<unknown>;
            if (!commands.some((command) => command.id === result.id)) return;
            results.set(result.id, result);
            console.log('[ha-ws] result', { id: result.id, success: result.success, error: result.error?.message });
            if (results.size === commands.length) {
              ws.close();
              settle(() => resolve(results));
            }
          }
        } catch (error) {
          ws.close();
          console.log('[ha-ws] parse failed', { error });
          settle(() => reject(new HomeAssistantError('SERVICE_FAILED', error instanceof Error ? error.message : String(error))));
        }
      });
    });
  }

  private async discoverEntitiesWithoutCache(domains = ['light', 'switch', 'button', 'number', 'climate', 'sensor']) {
    const toStringValue = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : undefined;
    const normalizeEntityEntry = (entity: Record<string, unknown>): HaEntityRegistryEntry => ({
      entity_id: toStringValue(entity.ei) ?? toStringValue(entity.entity_id) ?? '',
      device_id: toStringValue(entity.di) ?? toStringValue(entity.device_id),
      area_id: toStringValue(entity.ai) ?? toStringValue(entity.area_id),
      platform: toStringValue(entity.pl) ?? toStringValue(entity.platform),
      unique_id: toStringValue(entity.unique_id) ?? toStringValue(entity.tk),
      original_name: toStringValue(entity.original_name),
      name: toStringValue(entity.en) ?? toStringValue(entity.name) ?? toStringValue(entity.original_name),
      device_info: undefined,
    });
    const normalizeDeviceEntry = (device: Record<string, unknown>): HaDeviceInfo => ({
      id: toStringValue(device.id) ?? toStringValue(device.device_id),
      name: toStringValue(device.name) ?? toStringValue(device.name_by_user),
      name_by_user: toStringValue(device.name_by_user),
      manufacturer: toStringValue(device.manufacturer),
      model: toStringValue(device.model),
      area_id: toStringValue(device.area_id),
    });
    const normalizeAreaEntry = (area: Record<string, unknown>): HaAreaInfo => ({
      area_id: toStringValue(area.area_id) ?? toStringValue(area.id) ?? toStringValue(area.ai) ?? '',
      name: toStringValue(area.name) ?? toStringValue(area.area_name) ?? '',
    });

    const [states, registryData] = await Promise.all([
      this.listStates(),
      this.wsBatchRequest([
        { id: 1, type: 'config/entity_registry/list_for_display' },
        { id: 2, type: 'config/entity_registry/list' },
        { id: 3, type: 'config/device_registry/list' },
        { id: 4, type: 'config/area_registry/list' },
      ])
        .then(async (results) => {
          const displayResult = results.get(1);
          const fullResult = results.get(2);
          const deviceResult = results.get(3);
          const areaResult = results.get(4);

          const asArray = (value: unknown) => Array.isArray(value) ? value : [];
          const asObject = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : undefined;

          const displayEntities = displayResult?.success
            ? asArray(asObject(displayResult.result)?.entities).map(normalizeEntityEntry).filter((entry) => entry.entity_id)
            : [];
          const fullEntityRegistry = fullResult?.success
            ? asArray(fullResult.result).map(normalizeEntityEntry).filter((entry) => entry.entity_id)
            : [];
          const deviceRegistry = deviceResult?.success
            ? asArray(asObject(deviceResult.result)?.devices ?? deviceResult.result).map(normalizeDeviceEntry)
            : [];
          const areas = areaResult?.success
            ? asArray(asObject(areaResult.result)?.areas ?? areaResult.result).map(normalizeAreaEntry).filter((area) => area.area_id)
            : [];

          return {
            displayEntityRegistry: displayEntities,
            fullEntityRegistry,
            deviceRegistry,
            areas,
          };
        })
    ]);
    const { displayEntityRegistry, fullEntityRegistry, deviceRegistry, areas } = registryData;
    const entityRegistry = [...displayEntityRegistry, ...fullEntityRegistry].reduce<HaEntityRegistryEntry[]>((entries, entry) => {
      const existingIndex = entries.findIndex((item) => item.entity_id === entry.entity_id);
      if (existingIndex === -1) return [...entries, entry];
      entries[existingIndex] = { ...entries[existingIndex], ...entry };
      return entries;
    }, []);
    console.log('[ha-registry] counts', {
      states: states.length,
      displayEntityRegistry: displayEntityRegistry.length,
      fullEntityRegistry: fullEntityRegistry.length,
      mergedEntityRegistry: entityRegistry.length,
      entitiesWithDevice: entityRegistry.filter((entry) => entry.device_id).length,
      entitiesWithArea: entityRegistry.filter((entry) => entry.area_id).length,
      deviceRegistry: deviceRegistry.length,
      areas: areas.length,
    });
    console.log('[ha-registry] sample entities', entityRegistry.slice(0, 10));
    console.log('[ha-registry] sample devices', deviceRegistry.slice(0, 10));
    console.log('[ha-registry] sample areas', areas.slice(0, 10));

    const areaById = new Map(areas.map((area) => [area.area_id, area]));
    const deviceRegistryById = new Map(deviceRegistry.filter((device): device is HaDeviceInfo & { id: string } => typeof device.id === 'string').map((device) => [device.id, device]));
    const entityRegistryByEntityId = new Map(entityRegistry.filter((entry): entry is HaEntityRegistryEntry & { entity_id: string } => typeof entry.entity_id === 'string').map((entry) => [entry.entity_id, entry]));

    return states
      .filter((item) => typeof item.entity_id === 'string' && domains.some((domain) => (item.entity_id as string).startsWith(`${domain}.`)))
      .map((item) => {
        const entityId = item.entity_id as string;
        const snapshot = extractEntityCapabilitySnapshot(item);
        const entityEntry = entityRegistryByEntityId.get(entityId);
        const displayEntry = displayEntityRegistry.find((entry) => entry.entity_id === entityId);
        const displayRaw = displayEntry as unknown as Record<string, unknown> | undefined;
        const deviceId = typeof displayRaw?.di === 'string' ? displayRaw.di : entityEntry?.device_id;
        const device = deviceId ? deviceRegistryById.get(deviceId) : undefined;
        const areaId = typeof displayRaw?.ai === 'string' ? displayRaw.ai : entityEntry?.area_id ?? device?.area_id;
        const area = areaId ? areaById.get(areaId) : undefined;
        const base = snapshot ?? {
          entity_id: entityId,
          domain: entityId.split('.')[0],
          state: 'unknown',
          friendly_name: typeof displayRaw?.en === 'string' ? displayRaw.en : entityEntry?.name ?? entityEntry?.original_name ?? entityId,
          supports_brightness: false,
          supports_value: false,
          supports_temperature: false,
          supports_hvac_mode: false,
          supports_fan_mode: false,
          supports_swing_mode: false,
          supported_color_modes: [],
          hvac_modes: [],
          fan_modes: [],
          swing_modes: [],
          raw: item,
        };

        return {
          ...base,
          device_id: deviceId,
          device_name: device?.name_by_user ?? device?.name ?? entityEntry?.name ?? entityEntry?.original_name ?? (typeof displayRaw?.en === 'string' ? displayRaw.en : entityId),
          device_manufacturer: device?.manufacturer,
          device_model: device?.model,
          area_id: areaId,
          area_name: area?.name,
          unique_id: entityEntry?.unique_id,
          platform: entityEntry?.platform ?? displayRaw?.pl as string | undefined,
        };
      });
  }

  async discoverEntities(domains = ['light', 'switch', 'button', 'number', 'climate', 'sensor']) {
    const key = domains.slice().sort().join('|');
    const now = Date.now();
    const cached = this.entityDiscoveryCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    const inFlight = this.entityDiscoveryInFlight.get(key);
    if (inFlight) return inFlight;

    const promise = this.discoverEntitiesWithoutCache(domains)
      .then((value) => {
        this.entityDiscoveryCache.set(key, { expiresAt: Date.now() + 10_000, value });
        this.entityDiscoveryInFlight.delete(key);
        return value;
      })
      .catch((error) => {
        this.entityDiscoveryInFlight.delete(key);
        throw error;
      });

    this.entityDiscoveryInFlight.set(key, promise);
    return promise;
  }

  discoverLights() {
    return this.discoverEntities(['light']);
  }

  turnOn(entityId: string) {
    const domain = entityId.split('.')[0];
    return this.request(`/api/services/${domain}/turn_on`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
  }

  turnOff(entityId: string) {
    const domain = entityId.split('.')[0];
    return this.request(`/api/services/${domain}/turn_off`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
  }

  async turnOnLight(entityId: string, brightness?: number, colorTempKelvin?: number) {
    if (colorTempKelvin === undefined) {
      return this.request('/api/services/light/turn_on', {
        method: 'POST',
        body: JSON.stringify({ entity_id: entityId, ...(brightness === undefined ? {} : { brightness }) }),
      });
    }

    return this.setLightColorTemp(entityId, colorTempKelvin, brightness);
  }

  async setLightColorTemp(entityId: string, colorTempKelvin: number, brightness?: number) {
    const basePayload = { entity_id: entityId, ...(brightness === undefined ? {} : { brightness }) };
    const candidates = [
      { ...basePayload, color_temp_kelvin: colorTempKelvin },
      { ...basePayload, kelvin: colorTempKelvin },
      { ...basePayload, color_temp: Math.round(1000000 / colorTempKelvin) },
    ];

    let lastError: unknown;
    for (const payload of candidates) {
      try {
        return await this.request('/api/services/light/turn_on', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } catch (error) {
        lastError = error;
        if (!(error instanceof HomeAssistantError) || error.code !== 'SERVICE_FAILED' || error.status !== 400) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  turnOffLight(entityId: string) {
    return this.request('/api/services/light/turn_off', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
  }

  toggleLight(entityId: string) {
    return this.request('/api/services/light/toggle', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
  }

  pressButton(entityId: string) {
    return this.request('/api/services/button/press', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
  }

  setNumberValue(entityId: string, value: number) {
    return this.request('/api/services/number/set_value', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, value }),
    });
  }

  setClimateTemperature(entityId: string, temperature: number) {
    return this.request('/api/services/climate/set_temperature', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, temperature }),
    });
  }

  setClimateHvacMode(entityId: string, hvacMode: string) {
    return this.request('/api/services/climate/set_hvac_mode', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, hvac_mode: hvacMode }),
    });
  }

  setClimateFanMode(entityId: string, fanMode: string) {
    return this.request('/api/services/climate/set_fan_mode', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, fan_mode: fanMode }),
    });
  }

  setClimateSwingMode(entityId: string, swingMode: string) {
    return this.request('/api/services/climate/set_swing_mode', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, swing_mode: swingMode }),
    });
  }
}
