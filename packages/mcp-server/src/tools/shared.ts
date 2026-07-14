import type { AuditEvent } from '../models/types.js';
import type { AuditLogger } from '../services/audit-logger.js';

export const makeRequestId = () => `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
export const now = () => new Date().toISOString();

export type StateSummary = {
  state_after: string;
  brightness_after?: number;
  color_temp_kelvin_after?: number;
  color_temp_mired_after?: number;
  temperature_after?: number;
  hvac_mode_after?: string;
  fan_mode_after?: string;
  swing_mode_after?: string;
};

export const isEntityUnavailable = (state?: string) => state === 'unavailable';

export const buildUnavailableError = (entityId: string, state?: string) => ({
  error_code: 'DEVICE_UNAVAILABLE' as const,
  message: '设备离线',
  details: { entity_id: entityId, state: state ?? 'unknown' },
});

const resolveColorTempKelvin = (attributes: Record<string, unknown> | undefined) => {
  if (!attributes) return undefined;
  if (typeof attributes.color_temp_kelvin === 'number') return attributes.color_temp_kelvin;
  if (typeof attributes.color_temp === 'number' && attributes.color_temp > 0) return Math.round(1000000 / attributes.color_temp);
  return undefined;
};

export const buildStateSummary = (state: Record<string, unknown>): StateSummary => {
  const current = typeof state.state === 'string' ? state.state : 'unknown';
  const attributes = state.attributes as Record<string, unknown> | undefined;
  const brightness = typeof attributes?.brightness === 'number' ? attributes.brightness : undefined;
  const colorTempKelvin = resolveColorTempKelvin(attributes);
  const colorTempMired = typeof attributes?.color_temp === 'number' ? attributes.color_temp : undefined;

  return {
    state_after: current,
    ...(typeof brightness === 'number' ? { brightness_after: brightness } : {}),
    ...(typeof colorTempKelvin === 'number' ? { color_temp_kelvin_after: colorTempKelvin } : {}),
    ...(typeof colorTempMired === 'number' ? { color_temp_mired_after: colorTempMired } : {}),
  };
};

export const hasExpectedPowerState = (summary: StateSummary, action: 'on' | 'off') =>
  summary.state_after === action;

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForExpectedPowerState = async (
  readState: () => Promise<Record<string, unknown>>,
  expected: 'on' | 'off',
  retries = 1,
  delayMs = 250,
) => {
  let lastSummary: StateSummary = { state_after: 'unknown' };

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const state = await readState();
    lastSummary = buildStateSummary(state);
    if (hasExpectedPowerState(lastSummary, expected)) {
      return { confirmed: true as const, summary: lastSummary };
    }

    if (attempt < retries) {
      await wait(delayMs);
    }
  }

  return { confirmed: false as const, summary: lastSummary };
};

export const writeAudit = async (auditLogger: AuditLogger, event: AuditEvent) => {
  void auditLogger.write(event).catch((error) => {
    console.error('[audit] failed to write event', error);
  });
};
