import type {
  DeviceCapability,
  DeviceDomain,
  HaEntityCapabilitySnapshot,
  LightDevice,
} from '../models/types.js';

const KNOWN_DOMAINS = new Set<DeviceDomain>(['light', 'switch', 'button', 'number', 'climate', 'sensor']);
const BRIGHTNESS_COLOR_MODES = new Set(['brightness', 'color_temp', 'hs', 'xy', 'rgb', 'rgbw', 'rgbww', 'white']);
const LEGACY_BRIGHTNESS_FEATURE = 1;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const asStringOrNumber = (value: unknown): string | number | undefined =>
  typeof value === 'string' || typeof value === 'number' ? value : undefined;

const hasBrightnessColorMode = (mode: string | undefined) =>
  typeof mode === 'string' && BRIGHTNESS_COLOR_MODES.has(mode);

export const normalizeDeviceCapabilities = (device: LightDevice): LightDevice => {
  const capabilities = new Set<DeviceCapability>(device.capabilities);

  if (device.domain === 'light') {
    capabilities.add('turn_on');
    capabilities.add('turn_off');
    capabilities.add('get_state');
    if (device.supports_brightness) {
      capabilities.add('set_brightness');
    } else {
      capabilities.delete('set_brightness');
    }
  }

  if (device.domain === 'switch') {
    capabilities.add('turn_on');
    capabilities.add('turn_off');
    capabilities.add('get_state');
    capabilities.delete('set_brightness');
  }

  if (device.domain === 'button') {
    capabilities.add('press');
    capabilities.delete('turn_on');
    capabilities.delete('turn_off');
    capabilities.delete('set_brightness');
  }

  if (device.domain === 'number') {
    capabilities.add('set_value');
    capabilities.add('get_state');
    capabilities.delete('turn_on');
    capabilities.delete('turn_off');
    capabilities.delete('set_brightness');
  }

  if (device.domain === 'climate') {
    capabilities.add('get_state');
    if (device.supports_temperature || capabilities.has('set_temperature')) {
      capabilities.add('set_temperature');
    }
    if (device.supports_hvac_mode || capabilities.has('set_hvac_mode')) {
      capabilities.add('set_hvac_mode');
    }
    if (device.supports_fan_mode || capabilities.has('set_fan_mode')) {
      capabilities.add('set_fan_mode');
    }
    if (device.supports_swing_mode || capabilities.has('set_swing_mode')) {
      capabilities.add('set_swing_mode');
    }
    capabilities.delete('turn_on');
    capabilities.delete('turn_off');
    capabilities.delete('set_brightness');
    capabilities.delete('set_value');
    capabilities.delete('press');
  }

  if (device.domain === 'sensor') {
    capabilities.add('get_state');
    capabilities.delete('turn_on');
    capabilities.delete('turn_off');
    capabilities.delete('set_brightness');
    capabilities.delete('set_value');
    capabilities.delete('press');
    capabilities.delete('set_temperature');
    capabilities.delete('set_hvac_mode');
    capabilities.delete('set_fan_mode');
    capabilities.delete('set_swing_mode');
  }

  return {
    ...device,
    supports_brightness: device.domain === 'light' && (device.supports_brightness || capabilities.has('set_brightness')),
    supports_temperature: device.domain === 'climate' && (device.supports_temperature || capabilities.has('set_temperature')),
    supports_hvac_mode: device.domain === 'climate' && (device.supports_hvac_mode || capabilities.has('set_hvac_mode')),
    supports_fan_mode: device.domain === 'climate' && (device.supports_fan_mode || capabilities.has('set_fan_mode')),
    supports_swing_mode: device.domain === 'climate' && (device.supports_swing_mode || capabilities.has('set_swing_mode')),
    capabilities: [...capabilities],
    capability_source: device.capability_source ?? 'config',
  };
};

export const extractEntityCapabilitySnapshot = (
  state: Record<string, unknown>,
): HaEntityCapabilitySnapshot | undefined => {
  const entityId = typeof state.entity_id === 'string' ? state.entity_id : undefined;
  if (!entityId) return undefined;

  const domain = entityId.split('.')[0] ?? '';
  const attributes = asRecord(state.attributes);
  const supportedColorModes = asStringArray(attributes.supported_color_modes);
  const colorMode = typeof attributes.color_mode === 'string' ? attributes.color_mode : undefined;
  const brightness = asNumber(attributes.brightness);
  const supportedFeatures = asNumber(attributes.supported_features);
  const hvacModes = asStringArray(attributes.hvac_modes);
  const fanModes = asStringArray(attributes.fan_modes);
  const swingModes = asStringArray(attributes.swing_modes);
  const stateValue = typeof state.state === 'string' ? state.state : 'unknown';
  const supportsBrightness =
    domain === 'light' &&
    (supportedColorModes.some(hasBrightnessColorMode) ||
      hasBrightnessColorMode(colorMode) ||
      brightness !== undefined ||
      ((supportedFeatures ?? 0) & LEGACY_BRIGHTNESS_FEATURE) === LEGACY_BRIGHTNESS_FEATURE);

  return {
    entity_id: entityId,
    domain,
    state: stateValue,
    friendly_name: typeof attributes.friendly_name === 'string' ? attributes.friendly_name : entityId,
    supports_brightness: supportsBrightness,
    supports_value:
      domain === 'number' &&
      (asNumber(attributes.min) !== undefined || asNumber(attributes.max) !== undefined || asNumber(attributes.step) !== undefined),
    supports_temperature:
      domain === 'climate' &&
      (asNumber(attributes.temperature) !== undefined ||
        asNumber(attributes.target_temp_low) !== undefined ||
        asNumber(attributes.target_temp_high) !== undefined ||
        asNumber(attributes.min_temp) !== undefined ||
        asNumber(attributes.max_temp) !== undefined),
    supports_hvac_mode: domain === 'climate' && hvacModes.length > 0,
    supports_fan_mode: domain === 'climate' && fanModes.length > 0,
    supports_swing_mode: domain === 'climate' && swingModes.length > 0,
    supported_color_modes: supportedColorModes,
    color_mode: colorMode,
    brightness,
    value_min: asNumber(attributes.min),
    value_max: asNumber(attributes.max),
    value_step: asNumber(attributes.step),
    temperature_min: asNumber(attributes.min_temp),
    temperature_max: asNumber(attributes.max_temp),
    temperature_step: asNumber(attributes.target_temp_step),
    temperature_unit: typeof attributes.unit_of_measurement === 'string' ? attributes.unit_of_measurement : undefined,
    current_temperature: asNumber(attributes.current_temperature),
    target_temperature: asNumber(attributes.temperature),
    hvac_mode: domain === 'climate' ? stateValue : undefined,
    hvac_modes: hvacModes,
    fan_mode: typeof attributes.fan_mode === 'string' ? attributes.fan_mode : undefined,
    fan_modes: fanModes,
    swing_mode: typeof attributes.swing_mode === 'string' ? attributes.swing_mode : undefined,
    swing_modes: swingModes,
    sensor_unit: typeof attributes.unit_of_measurement === 'string' ? attributes.unit_of_measurement : undefined,
    sensor_value: domain === 'sensor' ? asStringOrNumber(state.state) : undefined,
    raw: state,
  };
};

export const mergeDeviceWithHaSnapshot = (
  device: LightDevice,
  snapshot: HaEntityCapabilitySnapshot,
): LightDevice => {
  const snapshotDomain = KNOWN_DOMAINS.has(snapshot.domain as DeviceDomain)
    ? (snapshot.domain as DeviceDomain)
    : device.domain;
  const merged: LightDevice = {
    ...device,
    domain: snapshotDomain,
    type: snapshotDomain,
    friendly_name: snapshot.friendly_name,
    state: snapshot.state,
    supports_brightness: snapshotDomain === 'light' ? snapshot.supports_brightness : false,
    supports_value: snapshotDomain === 'number' ? snapshot.supports_value : device.supports_value,
    supports_temperature: snapshotDomain === 'climate' ? snapshot.supports_temperature : device.supports_temperature,
    supports_hvac_mode: snapshotDomain === 'climate' ? snapshot.supports_hvac_mode : device.supports_hvac_mode,
    supports_fan_mode: snapshotDomain === 'climate' ? snapshot.supports_fan_mode : device.supports_fan_mode,
    supports_swing_mode: snapshotDomain === 'climate' ? snapshot.supports_swing_mode : device.supports_swing_mode,
    value_min: snapshot.value_min ?? device.value_min,
    value_max: snapshot.value_max ?? device.value_max,
    value_step: snapshot.value_step ?? device.value_step,
    temperature_min: snapshot.temperature_min ?? device.temperature_min,
    temperature_max: snapshot.temperature_max ?? device.temperature_max,
    temperature_step: snapshot.temperature_step ?? device.temperature_step,
    temperature_unit: snapshot.temperature_unit ?? device.temperature_unit,
    current_temperature: snapshot.current_temperature ?? device.current_temperature,
    target_temperature: snapshot.target_temperature ?? device.target_temperature,
    hvac_mode: snapshot.hvac_mode ?? device.hvac_mode,
    hvac_modes: snapshot.hvac_modes.length > 0 ? snapshot.hvac_modes : device.hvac_modes,
    fan_mode: snapshot.fan_mode ?? device.fan_mode,
    fan_modes: snapshot.fan_modes.length > 0 ? snapshot.fan_modes : device.fan_modes,
    swing_mode: snapshot.swing_mode ?? device.swing_mode,
    swing_modes: snapshot.swing_modes.length > 0 ? snapshot.swing_modes : device.swing_modes,
    sensor_unit: snapshot.sensor_unit ?? device.sensor_unit,
    sensor_value: snapshot.sensor_value ?? device.sensor_value,
    supported_color_modes: snapshot.supported_color_modes,
    color_mode: snapshot.color_mode,
    brightness: snapshot.brightness,
    capability_source: 'home_assistant',
  };

  return normalizeDeviceCapabilities(merged);
};
