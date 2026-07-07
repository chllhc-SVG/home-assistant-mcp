export interface LogRecord {
  id: string;
  request_id: string;
  timestamp: string;
  user_input?: string;
  intent?: string;
  tool_name: string;
  device_name?: string;
  result_status: 'success' | 'failure';
  error_code?: string;
  duration_ms?: number;
  resolved_device?: { display_name: string; entity_id: string };
  tool_args?: Record<string, unknown>;
}

export interface OverviewStats {
  total: number;
  success: number;
  failure: number;
  successRate: number;
}

export interface FailureStats {
  total: number;
  byErrorCode: Record<string, number>;
  byTool: Record<string, number>;
}

export interface PaginatedLogResponse {
  items: LogRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DeviceRecord {
  device_id: string;
  display_name: string;
  aliases?: string[];
  entity_id: string;
  domain?: 'light' | 'switch' | 'button' | 'number' | 'climate' | 'sensor';
  room?: string;
  type?: 'light' | 'switch' | 'button' | 'number' | 'climate' | 'sensor';
  state?: string;
  friendly_name?: string;
  exposed?: boolean;
  supports_brightness?: boolean;
  supports_value?: boolean;
  value_min?: number;
  value_max?: number;
  value_step?: number;
  supported_color_modes?: string[];
  color_mode?: string;
  color_temp_min_kelvin?: number;
  color_temp_max_kelvin?: number;
  brightness?: number;
  supports_temperature?: boolean;
  supports_hvac_mode?: boolean;
  supports_fan_mode?: boolean;
  supports_swing_mode?: boolean;
  temperature_min?: number;
  temperature_max?: number;
  temperature_step?: number;
  temperature_unit?: string;
  current_temperature?: number;
  target_temperature?: number;
  hvac_mode?: string;
  hvac_modes?: string[];
  fan_mode?: string;
  fan_modes?: string[];
  swing_mode?: string;
  swing_modes?: string[];
  sensor_unit?: string;
  sensor_value?: string | number;
  capability_source?: 'config' | 'home_assistant';
  capabilities?: string[];
  risk_level?: string;
  enabled?: boolean;
  stateless?: boolean;
}

export interface DiscoveredEntity {
  entity_id: string;
  domain?: string;
  friendly_name: string;
  state: string;
  supports_brightness: boolean;
  supports_value?: boolean;
  supports_temperature?: boolean;
  supports_hvac_mode?: boolean;
  supports_fan_mode?: boolean;
  supports_swing_mode?: boolean;
  supported_color_modes?: string[];
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
  hvac_modes?: string[];
  fan_mode?: string;
  fan_modes?: string[];
  swing_mode?: string;
  swing_modes?: string[];
  sensor_unit?: string;
  sensor_value?: string | number;
}

export type DiscoveredLight = DiscoveredEntity;

export interface DeviceExposureConfig {
  rooms: Array<{ room: string; enabled: boolean }>;
  devices: string[];
}

export interface ControlResult {
  entity_id: string;
  action: string;
  state_after?: string;
  brightness?: number;
  brightness_after?: number;
  color_temp_kelvin?: number;
  temperature?: number;
  hvac_mode?: string;
  fan_mode?: string;
  swing_mode?: string;
  value?: number;
}

const baseUrl = import.meta.env.VITE_ADMIN_API_BASE_URL ?? 'http://127.0.0.1:4000';

const formatApiError = (payload: unknown, fallback: string) => {
  const error = typeof payload === 'object' && payload !== null && 'error' in payload
    ? (payload as { error?: { error_code?: string; message?: string; details?: Record<string, unknown> } }).error
    : undefined;
  if (!error) return fallback;

  const detailText = error.details
    ? Object.entries(error.details)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ')
    : '';
  const codeText = error.error_code ? `[${error.error_code}] ` : '';
  return `${codeText}${error.message ?? fallback}${detailText ? ` (${detailText})` : ''}`;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(formatApiError(payload, `Request failed: ${response.status}`));
  }
  if (payload?.success === false) throw new Error(formatApiError(payload, 'Unknown error'));
  return payload.data as T;
}

export const api = {
  getOverview: () => request<OverviewStats>('/api/admin/stats/overview'),
  getFailureStats: () => request<FailureStats>('/api/admin/stats/errors'),
  listLogs: (params = new URLSearchParams()) => request<PaginatedLogResponse>(`/api/admin/logs?${params.toString()}`),
  getLogById: (id: string) => request<LogRecord>(`/api/admin/logs/${id}`),
  listDevices: () => request<{ devices: DeviceRecord[] }>('/api/admin/devices'),
  getDeviceExposure: () => request<{ exposure: string[] }>('/api/admin/device-exposure'),
  saveDeviceExposure: (payload: DeviceExposureConfig) => request<{ saved: boolean }>('/api/admin/device-exposure', { method: 'POST', body: JSON.stringify(payload) }),
  discoverLights: () => request<{ lights: DiscoveredLight[] }>('/api/admin/ha/lights/discover'),
  discoverEntities: () => request<{ entities: DiscoveredEntity[] }>('/api/admin/ha/entities/discover'),
  getLightState: (entityId: string) => request<Record<string, unknown>>(`/api/control/lights/${encodeURIComponent(entityId)}/state`),
  turnOnLight: (entityId: string) => request<ControlResult>(`/api/control/lights/${encodeURIComponent(entityId)}/turn-on`, { method: 'POST', body: '{}' }),
  turnOffLight: (entityId: string) => request<ControlResult>(`/api/control/lights/${encodeURIComponent(entityId)}/turn-off`, { method: 'POST', body: '{}' }),
  setLightBrightness: (entityId: string, brightness: number) => request<ControlResult>(`/api/control/lights/${encodeURIComponent(entityId)}/brightness`, { method: 'POST', body: JSON.stringify({ brightness }) }),
  setLightState: (entityId: string, state: 'on' | 'off', brightness?: number, color_temp_kelvin?: number) => request<ControlResult>(`/api/control/lights/${encodeURIComponent(entityId)}/state`, { method: 'POST', body: JSON.stringify({ state, brightness, color_temp_kelvin }) }),
  turnOnSwitch: (entityId: string) => request<ControlResult>(`/api/control/switches/${encodeURIComponent(entityId)}/turn-on`, { method: 'POST', body: '{}' }),
  turnOffSwitch: (entityId: string) => request<ControlResult>(`/api/control/switches/${encodeURIComponent(entityId)}/turn-off`, { method: 'POST', body: '{}' }),
  getSwitchState: (entityId: string) => request<Record<string, unknown>>(`/api/control/switches/${encodeURIComponent(entityId)}/state`),
  pressButton: (entityId: string) => request<ControlResult>(`/api/control/buttons/${encodeURIComponent(entityId)}/press`, { method: 'POST', body: '{}' }),
  getButtonState: (entityId: string) => request<Record<string, unknown>>(`/api/control/buttons/${encodeURIComponent(entityId)}/state`),
  setNumberValue: (entityId: string, value: number) => request<ControlResult>(`/api/control/numbers/${encodeURIComponent(entityId)}/value`, { method: 'POST', body: JSON.stringify({ value }) }),
  getNumberState: (entityId: string) => request<Record<string, unknown>>(`/api/control/numbers/${encodeURIComponent(entityId)}/state`),
  getSensorState: (entityId: string) => request<Record<string, unknown>>(`/api/control/sensors/${encodeURIComponent(entityId)}/state`),
  getClimateState: (entityId: string) => request<Record<string, unknown>>(`/api/control/climates/${encodeURIComponent(entityId)}/state`),
  setClimateTemperature: (entityId: string, temperature: number) => request<ControlResult>(`/api/control/climates/${encodeURIComponent(entityId)}/temperature`, { method: 'POST', body: JSON.stringify({ temperature }) }),
  setClimateHvacMode: (entityId: string, hvac_mode: string) => request<ControlResult>(`/api/control/climates/${encodeURIComponent(entityId)}/hvac-mode`, { method: 'POST', body: JSON.stringify({ hvac_mode }) }),
  setClimateFanMode: (entityId: string, fan_mode: string) => request<ControlResult>(`/api/control/climates/${encodeURIComponent(entityId)}/fan-mode`, { method: 'POST', body: JSON.stringify({ fan_mode }) }),
  setClimateSwingMode: (entityId: string, swing_mode: string) => request<ControlResult>(`/api/control/climates/${encodeURIComponent(entityId)}/swing-mode`, { method: 'POST', body: JSON.stringify({ swing_mode }) }),
};
