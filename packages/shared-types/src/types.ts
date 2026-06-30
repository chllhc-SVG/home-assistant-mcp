export interface LightDevice {
  device_id: string;
  display_name: string;
  aliases: string[];
  entity_id: string;
  domain: 'light';
  room: string;
  type: 'light';
  supports_brightness: boolean;
  capabilities: Array<'turn_on' | 'turn_off' | 'set_brightness' | 'get_state'>;
  risk_level: 'low' | 'medium' | 'high';
  enabled: boolean;
}

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