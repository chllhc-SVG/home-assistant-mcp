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
  domain?: 'light';
  room?: string;
  type?: 'light';
  supports_brightness?: boolean;
  capabilities?: string[];
  risk_level?: string;
  enabled?: boolean;
}

export interface DiscoveredLight {
  entity_id: string;
  friendly_name: string;
  state: string;
  supports_brightness: boolean;
}

export interface ControlResult {
  entity_id: string;
  action: string;
  state_after?: string;
  brightness?: number;
  brightness_after?: number;
}

const baseUrl = import.meta.env.VITE_ADMIN_API_BASE_URL ?? 'http://127.0.0.1:4000';

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
    throw new Error(payload?.error?.message ?? `Request failed: ${response.status}`);
  }
  if (payload?.success === false) throw new Error(payload?.error?.message ?? 'Unknown error');
  return payload.data as T;
}

export const api = {
  getOverview: () => request<OverviewStats>('/api/admin/stats/overview'),
  getFailureStats: () => request<FailureStats>('/api/admin/stats/errors'),
  listLogs: (params = new URLSearchParams()) => request<PaginatedLogResponse>(`/api/admin/logs?${params.toString()}`),
  getLogById: (id: string) => request<LogRecord>(`/api/admin/logs/${id}`),
  listDevices: () => request<{ devices: DeviceRecord[] }>('/api/admin/devices'),
  discoverLights: () => request<{ lights: DiscoveredLight[] }>('/api/admin/ha/lights/discover'),
  getLightState: (entityId: string) => request<Record<string, unknown>>(`/api/control/lights/${encodeURIComponent(entityId)}/state`),
  turnOnLight: (entityId: string) => request<ControlResult>(`/api/control/lights/${encodeURIComponent(entityId)}/turn-on`, { method: 'POST', body: '{}' }),
  turnOffLight: (entityId: string) => request<ControlResult>(`/api/control/lights/${encodeURIComponent(entityId)}/turn-off`, { method: 'POST', body: '{}' }),
  setLightBrightness: (entityId: string, brightness: number) => request<ControlResult>(`/api/control/lights/${encodeURIComponent(entityId)}/brightness`, { method: 'POST', body: JSON.stringify({ brightness }) }),
  setLightState: (entityId: string, state: 'on' | 'off', brightness?: number) => request<ControlResult>(`/api/control/lights/${encodeURIComponent(entityId)}/state`, { method: 'POST', body: JSON.stringify({ state, brightness }) }),
};
