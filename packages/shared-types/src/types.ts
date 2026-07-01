export type DeviceDomain = 'light' | 'switch' | 'button' | 'number' | 'climate' | 'sensor';
export type DeviceCapability =
  | 'turn_on'
  | 'turn_off'
  | 'set_brightness'
  | 'get_state'
  | 'press'
  | 'set_value'
  | 'set_temperature'
  | 'set_hvac_mode'
  | 'set_fan_mode'
  | 'set_swing_mode';
export type DeviceRiskLevel = 'low' | 'medium' | 'high';
export type CapabilitySource = 'config' | 'home_assistant';
export type ClimateHvacMode = 'off' | 'heat' | 'cool' | 'heat_cool' | 'auto' | 'dry' | 'fan_only';

export interface ControllableDevice {
  device_id: string;
  display_name: string;
  aliases: string[];
  entity_id: string;
  domain: DeviceDomain;
  room: string;
  type: DeviceDomain;
  supports_brightness: boolean;
  supports_value?: boolean;
  supports_temperature?: boolean;
  supports_hvac_mode?: boolean;
  supports_fan_mode?: boolean;
  supports_swing_mode?: boolean;
  value_min?: number;
  value_max?: number;
  value_step?: number;
  temperature_min?: number;
  temperature_max?: number;
  temperature_step?: number;
  temperature_unit?: string;
  current_temperature?: number;
  target_temperature?: number;
  hvac_mode?: ClimateHvacMode | string;
  hvac_modes?: Array<ClimateHvacMode | string>;
  fan_mode?: string;
  fan_modes?: string[];
  swing_mode?: string;
  swing_modes?: string[];
  sensor_unit?: string;
  sensor_value?: string | number;
  state?: string;
  friendly_name?: string;
  supported_color_modes?: string[];
  color_mode?: string;
  brightness?: number;
  capability_source?: CapabilitySource;
  capabilities: DeviceCapability[];
  risk_level: DeviceRiskLevel;
  enabled: boolean;
}

export type LightDevice = ControllableDevice;

export interface AuditRecord {
  id: string;
  request_id: string;
  timestamp: string;
  user_id?: string;
  user_input?: string;
  intent?: string;
  device_id?: string;
  entity_id?: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  ha_request?: Record<string, unknown>;
  ha_response?: Record<string, unknown>;
  result_status: 'success' | 'failure';
  error_code?: string;
  duration_ms?: number;
}
