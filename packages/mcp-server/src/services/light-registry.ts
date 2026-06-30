import type { LightDevice } from '../models/types.js';

export class LightRegistry {
  constructor(private readonly devices: LightDevice[]) {}

  list(filter?: { room?: string; keyword?: string; supportBrightness?: boolean }) {
    return this.devices.filter((device) => {
      if (!device.enabled) return false;
      if (filter?.room && device.room !== filter.room) return false;
      if (filter?.keyword && ![device.display_name, ...device.aliases].some((value) => value.includes(filter.keyword!))) return false;
      if (filter?.supportBrightness !== undefined && device.supports_brightness !== filter.supportBrightness) return false;
      return true;
    });
  }

  resolve(query: string) {
    const normalized = query.trim();
    const matches = this.list().filter((device) =>
      [device.display_name, ...device.aliases].some((value) => value.includes(normalized)),
    );

    return matches;
  }

  getByEntityId(entityId: string) {
    return this.devices.find((device) => device.entity_id === entityId && device.enabled);
  }
}