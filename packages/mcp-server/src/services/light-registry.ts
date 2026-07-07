import type { LightDevice } from '../models/types.js';
import {
  mergeDeviceWithHaSnapshot,
  normalizeDeviceCapabilities,
} from './device-capabilities.js';
import type { HaClient } from './ha-client.js';

interface DeviceFilter {
  domain?: string;
  room?: string;
  keyword?: string;
  supportBrightness?: boolean;
  enabledOnly?: boolean;
}

const groupedTestRoomLightIds = new Set(['light.aimore_230915_ca16_light', 'light.aimore_230915_6a5d_light']);
const groupedTestRoomLightDisplayName = '测试间主灯';

const isGroupedTestRoomLight = (device: LightDevice) => groupedTestRoomLightIds.has(device.entity_id);

const mergeGroupedTestRoomLights = (devices: LightDevice[]) => {
  const grouped = devices.filter(isGroupedTestRoomLight);
  const others = devices.filter((device) => !isGroupedTestRoomLight(device));

  if (grouped.length === 0) return devices;

  const representative = grouped[0];
  const aliases = Array.from(new Set(grouped.flatMap((device) => [device.display_name, ...device.aliases])));

  return [
    {
      ...representative,
      display_name: groupedTestRoomLightDisplayName,
      aliases,
      entity_id: representative.entity_id,
      supports_brightness: grouped.some((device) => device.supports_brightness),
      supported_color_modes: Array.from(new Set(grouped.flatMap((device) => device.supported_color_modes ?? []))),
      color_mode: grouped.find((device) => device.color_mode)?.color_mode,
      color_temp_min_kelvin: grouped.reduce((min, device) => (typeof device.color_temp_min_kelvin === 'number' ? Math.max(min, device.color_temp_min_kelvin) : min), 0) || undefined,
      color_temp_max_kelvin: grouped.reduce((max, device) => (typeof device.color_temp_max_kelvin === 'number' ? Math.min(max, device.color_temp_max_kelvin) : max), Number.POSITIVE_INFINITY) || undefined,
      enabled: grouped.some((device) => device.enabled),
    },
    ...others,
  ];
};

export class LightRegistry {
  private devices: LightDevice[];
  private exposureDeviceIds: Set<string> | null = null;

  constructor(devices: LightDevice[]) {
    this.devices = devices.map(normalizeDeviceCapabilities);
  }

  setExposure(deviceIds: string[]) {
    this.exposureDeviceIds = deviceIds.length > 0 ? new Set(deviceIds) : null;
  }

  getExposure() {
    return this.exposureDeviceIds ? Array.from(this.exposureDeviceIds) : [];
  }

  list(filter?: DeviceFilter) {
    const filtered = this.devices.filter((device) => {
      if (this.exposureDeviceIds && !this.exposureDeviceIds.has(device.entity_id)) return false;
      if (filter?.enabledOnly !== false && !device.enabled) return false;
      if (filter?.domain && device.domain !== filter.domain) return false;
      if (filter?.room && device.room !== filter.room) return false;
      if (filter?.keyword && ![device.display_name, ...device.aliases].some((value) => value.includes(filter.keyword!))) return false;
      if (filter?.supportBrightness !== undefined && device.supports_brightness !== filter.supportBrightness) return false;
      return true;
    });

    return mergeGroupedTestRoomLights(filtered);
  }

  resolve(query: string, filter?: Pick<DeviceFilter, 'domain' | 'room'>) {
    const normalized = query.trim();
    return mergeGroupedTestRoomLights(this.list({ ...filter, enabledOnly: true })).filter((device) =>
      [device.display_name, ...device.aliases].some((value) => value.includes(normalized)),
    );
  }

  getByEntityId(entityId: string) {
    return this.devices.find((device) => device.entity_id === entityId && device.enabled);
  }

  upsert(device: LightDevice) {
    const normalized = normalizeDeviceCapabilities(device);
    const index = this.devices.findIndex((item) => item.entity_id === normalized.entity_id);

    if (index === -1) {
      this.devices.push(normalized);
      return normalized;
    }

    this.devices[index] = normalized;
    return normalized;
  }

  async refreshFromHomeAssistant(haClient: HaClient) {
    const snapshots = await haClient.discoverEntities();
    const snapshotsByEntityId = new Map(snapshots.map((snapshot) => [snapshot.entity_id, snapshot]));

    this.devices = this.devices.map((device) => {
      const snapshot = snapshotsByEntityId.get(device.entity_id);
      return snapshot ? mergeDeviceWithHaSnapshot(device, snapshot) : normalizeDeviceCapabilities(device);
    });

    return this.devices;
  }

  async tryRefreshFromHomeAssistant(haClient: HaClient) {
    try {
      await this.refreshFromHomeAssistant(haClient);
      return { refreshed: true as const };
    } catch (error) {
      return { refreshed: false as const, error };
    }
  }

  async listWithHomeAssistantState(haClient: HaClient, filter?: DeviceFilter) {
    await this.tryRefreshFromHomeAssistant(haClient);
    return this.list(filter);
  }
}
