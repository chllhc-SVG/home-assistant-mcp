import type { LightDevice } from '../models/types.js';
import { normalizeDeviceCapabilities } from './device-capabilities.js';

interface DeviceFilter {
  domain?: string;
  room?: string;
  keyword?: string;
  supportBrightness?: boolean;
  enabledOnly?: boolean;
}

export class LightRegistry {
  private devices: LightDevice[];
  private exposureDeviceIds: Set<string> | null = null;

  constructor(devices: LightDevice[]) {
    this.devices = devices.map(normalizeDeviceCapabilities);
  }

  setExposure(deviceIds: string[]) {
    this.exposureDeviceIds = deviceIds.length > 0 ? new Set(deviceIds) : null;
  }

  replace(devices: LightDevice[]) {
    this.devices = devices.map(normalizeDeviceCapabilities);
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

    return filtered;
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

}
