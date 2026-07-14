import type { LightDevice } from '../models/types.js';
import { normalizeDeviceCapabilities } from './device-capabilities.js';

interface DeviceFilter {
  domain?: string;
  room?: string;
  keyword?: string;
  supportBrightness?: boolean;
  enabledOnly?: boolean;
}

const normalizeText = (value: string) => value.toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
const tokenize = (value: string) => normalizeText(value).split(/\s+/).filter(Boolean);
const unique = (values: string[]) => Array.from(new Set(values));

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
      if (filter?.keyword && ![device.display_name, ...device.aliases].some((value) => normalizeText(value).includes(normalizeText(filter.keyword!)))) return false;
      if (filter?.supportBrightness !== undefined && device.supports_brightness !== filter.supportBrightness) return false;
      return true;
    });

    return filtered;
  }

  resolve(query: string, filter?: Pick<DeviceFilter, 'domain' | 'room'>) {
    const normalizedQuery = normalizeText(query);
    const queryTokens = tokenize(query);
    const temperatureIntent = /空调|温度|制冷|制热|恒温|温控/.test(normalizedQuery);
    const brightnessIntent = /亮度|调亮|调暗|变亮|变暗|灯光|主灯/.test(normalizedQuery);
    const scored = this.list({ ...filter, enabledOnly: true }).map((device) => {
      const haystacks = unique([
        device.display_name,
        device.entity_id,
        device.room,
        device.area_name ?? '',
        device.friendly_name ?? '',
        ...device.aliases,
      ].filter(Boolean).map(normalizeText));
      const joined = haystacks.join(' ');
      const exactMatch = joined.includes(normalizedQuery);
      const tokenHits = queryTokens.reduce((count, token) => count + (joined.includes(token) ? 1 : 0), 0);
      const aliasHits = device.aliases.reduce((count, alias) => count + (normalizeText(alias).includes(normalizedQuery) ? 1 : 0), 0);
      const roomHit = device.room && normalizeText(device.room).includes(normalizedQuery) ? 1 : 0;
      const areaHit = device.area_name && normalizeText(device.area_name).includes(normalizedQuery) ? 1 : 0;
      const climateBoost = temperatureIntent ? ((device.domain === 'climate' || device.supports_temperature) ? 60 : -20) : 0;
      const lightBoost = brightnessIntent ? (device.domain === 'light' ? 60 : -10) : 0;
      const score = (exactMatch ? 100 : 0) + tokenHits * 20 + aliasHits * 15 + roomHit * 10 + areaHit * 10 + climateBoost + lightBoost + Math.min(joined.includes(normalizedQuery) ? 10 : 0, 10);
      return { device, score };
    });

    return scored
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ device }) => device);
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
