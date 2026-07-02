import { randomUUID } from 'node:crypto';

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
  stateless?: boolean;
}

export type LightDevice = ControllableDevice;

export interface HaEntityCapabilitySnapshot {
  entity_id: string;
  domain: string;
  state: string;
  friendly_name: string;
  supports_brightness: boolean;
  supports_value: boolean;
  supports_temperature: boolean;
  supports_hvac_mode: boolean;
  supports_fan_mode: boolean;
  supports_swing_mode: boolean;
  supported_color_modes: string[];
  color_mode?: string;
  brightness?: number;
  value_min?: number;
  value_max?: number;
  value_step?: number;
  temperature_min?: number;
  temperature_max?: number;
  temperature_step?: number;
  temperature_unit?: string;
  current_temperature?: number;
  target_temperature?: number;
  hvac_mode?: string;
  hvac_modes: string[];
  fan_mode?: string;
  fan_modes: string[];
  swing_mode?: string;
  swing_modes: string[];
  sensor_unit?: string;
  sensor_value?: string | number;
  raw: Record<string, unknown>;
}

export interface ToolSuccess<T> {
  success: true;
  data: T;
  error: null;
}

export interface ToolFailure {
  success: false;
  data: null;
  error: {
    error_code:
      | 'DEVICE_NOT_FOUND'
      | 'DEVICE_AMBIGUOUS'
      | 'DEVICE_UNAVAILABLE'
      | 'INVALID_ARGUMENT'
      | 'BRIGHTNESS_NOT_SUPPORTED'
      | 'BRIGHTNESS_OUT_OF_RANGE'
      | 'STATE_NOT_CHANGED'
      | 'TEMPERATURE_NOT_SUPPORTED'
      | 'TEMPERATURE_OUT_OF_RANGE'
      | 'HVAC_MODE_NOT_SUPPORTED'
      | 'FAN_MODE_NOT_SUPPORTED'
      | 'SWING_MODE_NOT_SUPPORTED'
      | 'VALUE_OUT_OF_RANGE'
      | 'AUTH_FAILED'
      | 'TIMEOUT'
      | 'SERVICE_FAILED'
      | 'POLICY_DENIED';
    message: string;
    details: Record<string, unknown>;
  };
}

export type ToolResponse<T> = ToolSuccess<T> | ToolFailure;

export interface AuditEvent {
  id?: string;
  request_id: string;
  timestamp: string;
  source: 'mcp' | 'web';
  tool_name: string;
  user_input?: string;
  intent?: string;
  resolved_device?: {
    display_name: string;
    entity_id: string;
  };
  tool_args: Record<string, unknown>;
  ha_request?: Record<string, unknown>;
  ha_response?: Record<string, unknown>;
  result: {
    success: boolean;
    error_code?: string;
    state_after?: string;
    brightness_after?: number;
    temperature_after?: number;
    hvac_mode_after?: string;
    fan_mode_after?: string;
    swing_mode_after?: string;
    state_confirmed?: boolean;
  };
  duration_ms?: number;
  device_id?: string;
  entity_id?: string;
  error_code?: string;
  result_status?: 'success' | 'failure';
}

export interface AuditQuery {
  keyword?: string;
  tool_name?: string;
  device_name?: string;
  status?: 'success' | 'failure';
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditSummary {
  total: number;
  success: number;
  failure: number;
  successRate: number;
}

export type DeviceControlAction =
  | 'turn_on'
  | 'turn_off'
  | 'press'
  | 'set_brightness'
  | 'set_value'
  | 'set_temperature'
  | 'set_hvac_mode'
  | 'set_fan_mode'
  | 'set_swing_mode';

export interface DeviceResolutionResult {
  matched: boolean;
  confidence: number;
  candidates: LightDevice[];
  best_match?: LightDevice;
}

export interface DeviceListResult {
  total: number;
  devices: LightDevice[];
}

export const createRequestId = (): string => `req_${randomUUID()}`;
