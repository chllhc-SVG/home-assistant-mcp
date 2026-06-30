import type { LightDevice } from '../models/types.js';

export class PolicyEngine {
  canControlLight(device: LightDevice | undefined) {
    if (!device) return { allowed: false as const, reason: 'DEVICE_NOT_FOUND' as const };
    if (!device.enabled) return { allowed: false as const, reason: 'DEVICE_UNAVAILABLE' as const };
    if (!['light', 'switch'].includes(device.domain)) return { allowed: false as const, reason: 'POLICY_DENIED' as const };
    return { allowed: true as const };
  }

  canSetBrightness(device: LightDevice | undefined, brightness: number) {
    const base = this.canControlLight(device);
    if (!base.allowed) return base;
    if (device.domain !== 'light' || !device.supports_brightness) return { allowed: false as const, reason: 'BRIGHTNESS_NOT_SUPPORTED' as const };
    if (!Number.isInteger(brightness) || brightness < 0 || brightness > 255) {
      return { allowed: false as const, reason: 'BRIGHTNESS_OUT_OF_RANGE' as const };
    }
    return { allowed: true as const };
  }
}
