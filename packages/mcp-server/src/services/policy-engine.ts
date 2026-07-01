import type { LightDevice } from '../models/types.js';

export class PolicyEngine {
  canControlLight(device: LightDevice | undefined) {
    if (!device) return { allowed: false as const, reason: 'DEVICE_NOT_FOUND' as const };
    if (!device.enabled) return { allowed: false as const, reason: 'DEVICE_UNAVAILABLE' as const };
    if (!['light', 'switch', 'button', 'number', 'climate', 'sensor'].includes(device.domain)) return { allowed: false as const, reason: 'POLICY_DENIED' as const };
    return { allowed: true as const };
  }

  canControlSwitch(device: LightDevice | undefined) {
    const base = this.canControlLight(device);
    if (!base.allowed || !device) return base;
    if (device.domain !== 'switch') return { allowed: false as const, reason: 'POLICY_DENIED' as const };
    return { allowed: true as const };
  }

  canControlLightDomain(device: LightDevice | undefined) {
    const base = this.canControlLight(device);
    if (!base.allowed || !device) return base;
    if (device.domain !== 'light') return { allowed: false as const, reason: 'POLICY_DENIED' as const };
    return { allowed: true as const };
  }

  canSetBrightness(device: LightDevice | undefined, brightness: number) {
    const base = this.canControlLight(device);
    if (!base.allowed || !device) return base;
    if (device.domain !== 'light' || !device.supports_brightness) return { allowed: false as const, reason: 'BRIGHTNESS_NOT_SUPPORTED' as const };
    if (!Number.isInteger(brightness) || brightness < 0 || brightness > 255) {
      return { allowed: false as const, reason: 'BRIGHTNESS_OUT_OF_RANGE' as const };
    }
    return { allowed: true as const };
  }

  canPressButton(device: LightDevice | undefined) {
    const base = this.canControlLight(device);
    if (!base.allowed || !device) return base;
    if (device.domain !== 'button') return { allowed: false as const, reason: 'POLICY_DENIED' as const };
    return { allowed: true as const };
  }

  canSetValue(device: LightDevice | undefined, value: number) {
    const base = this.canControlLight(device);
    if (!base.allowed || !device) return base;
    if (device.domain !== 'number' || !device.supports_value) return { allowed: false as const, reason: 'POLICY_DENIED' as const };
    if (!Number.isFinite(value)) return { allowed: false as const, reason: 'INVALID_ARGUMENT' as const };
    if (typeof device.value_min === 'number' && value < device.value_min) return { allowed: false as const, reason: 'VALUE_OUT_OF_RANGE' as const };
    if (typeof device.value_max === 'number' && value > device.value_max) return { allowed: false as const, reason: 'VALUE_OUT_OF_RANGE' as const };
    return { allowed: true as const };
  }

  canReadNumber(device: LightDevice | undefined) {
    const base = this.canControlLight(device);
    if (!base.allowed || !device) return base;
    if (device.domain !== 'number') return { allowed: false as const, reason: 'POLICY_DENIED' as const };
    return { allowed: true as const };
  }

  canReadSensor(device: LightDevice | undefined) {
    const base = this.canControlLight(device);
    if (!base.allowed || !device) return base;
    if (device.domain !== 'sensor') return { allowed: false as const, reason: 'POLICY_DENIED' as const };
    return { allowed: true as const };
  }

  canSetClimateTemperature(device: LightDevice | undefined, temperature: number) {
    const base = this.canControlLight(device);
    if (!base.allowed || !device) return base;
    if (device.domain !== 'climate' || !device.supports_temperature) return { allowed: false as const, reason: 'TEMPERATURE_NOT_SUPPORTED' as const };
    if (!Number.isFinite(temperature)) return { allowed: false as const, reason: 'INVALID_ARGUMENT' as const };
    if (typeof device.temperature_min === 'number' && temperature < device.temperature_min) return { allowed: false as const, reason: 'TEMPERATURE_OUT_OF_RANGE' as const };
    if (typeof device.temperature_max === 'number' && temperature > device.temperature_max) return { allowed: false as const, reason: 'TEMPERATURE_OUT_OF_RANGE' as const };
    return { allowed: true as const };
  }

  canSetClimateHvacMode(device: LightDevice | undefined, hvacMode: string) {
    const base = this.canControlLight(device);
    if (!base.allowed || !device) return base;
    if (device.domain !== 'climate' || !device.supports_hvac_mode) return { allowed: false as const, reason: 'HVAC_MODE_NOT_SUPPORTED' as const };
    if (Array.isArray(device.hvac_modes) && device.hvac_modes.length > 0 && !device.hvac_modes.includes(hvacMode)) {
      return { allowed: false as const, reason: 'HVAC_MODE_NOT_SUPPORTED' as const };
    }
    return { allowed: true as const };
  }

  canSetClimateFanMode(device: LightDevice | undefined, fanMode: string) {
    const base = this.canControlLight(device);
    if (!base.allowed || !device) return base;
    if (device.domain !== 'climate' || !device.supports_fan_mode) return { allowed: false as const, reason: 'FAN_MODE_NOT_SUPPORTED' as const };
    if (Array.isArray(device.fan_modes) && device.fan_modes.length > 0 && !device.fan_modes.includes(fanMode)) {
      return { allowed: false as const, reason: 'FAN_MODE_NOT_SUPPORTED' as const };
    }
    return { allowed: true as const };
  }

  canSetClimateSwingMode(device: LightDevice | undefined, swingMode: string) {
    const base = this.canControlLight(device);
    if (!base.allowed || !device) return base;
    if (device.domain !== 'climate' || !device.supports_swing_mode) return { allowed: false as const, reason: 'SWING_MODE_NOT_SUPPORTED' as const };
    if (Array.isArray(device.swing_modes) && device.swing_modes.length > 0 && !device.swing_modes.includes(swingMode)) {
      return { allowed: false as const, reason: 'SWING_MODE_NOT_SUPPORTED' as const };
    }
    return { allowed: true as const };
  }
}
