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

export class LightRegistry {
  private devices: LightDevice[];

  constructor(devices: LightDevice[]) {
    this.devices = devices.map(normalizeDeviceCapabilities);
  }

  list(filter?: DeviceFilter) {
    return this.devices.filter((device) => {
      if (filter?.enabledOnly !== false && !device.enabled) return false;
      if (filter?.domain && device.domain !== filter.domain) return false;
      if (filter?.room && device.room !== filter.room) return false;
      if (filter?.keyword && ![device.display_name, ...device.aliases].some((value) => value.includes(filter.keyword!))) return false;
      if (filter?.supportBrightness !== undefined && device.supports_brightness !== filter.supportBrightness) return false;
      return true;
    });
  }

  resolve(query: string, filter?: Pick<DeviceFilter, 'domain' | 'room'>) {
    const normalized = query.trim();
    return this.list({ ...filter, enabledOnly: true }).filter((device) =>
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
