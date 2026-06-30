import { randomUUID } from 'node:crypto';

export type DeviceDomain = 'light' | 'switch';
export type DeviceCapability = 'turn_on' | 'turn_off' | 'set_brightness' | 'get_state';
export type DeviceRiskLevel = 'low' | 'medium' | 'high';

export interface ControllableDevice {
  device_id: string;
  display_name: string;
  aliases: string[];
  entity_id: string;
  domain: DeviceDomain;
  room: string;
  type: DeviceDomain;
  supports_brightness: boolean;
  capabilities: DeviceCapability[];
  risk_level: DeviceRiskLevel;
  enabled: boolean;
}

export type LightDevice = ControllableDevice;

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
  id: string;
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

export const createRequestId = (): string => `req_${randomUUID()}`;
