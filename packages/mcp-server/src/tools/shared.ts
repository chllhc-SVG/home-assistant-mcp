import type { AuditEvent } from '../models/types.js';
import type { AuditLogger } from '../services/audit-logger.js';

export const makeRequestId = () => `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
export const now = () => new Date().toISOString();

export type StateSummary = {
  state_after: string;
  brightness_after?: number;
  temperature_after?: number;
  hvac_mode_after?: string;
  fan_mode_after?: string;
  swing_mode_after?: string;
};

export const buildStateSummary = (state: Record<string, unknown>): StateSummary => {
  const current = typeof state.state === 'string' ? state.state : 'unknown';
  const attributes = state.attributes as Record<string, unknown> | undefined;
  const brightness = typeof attributes?.brightness === 'number' ? attributes.brightness : undefined;

  return {
    state_after: current,
    ...(typeof brightness === 'number' ? { brightness_after: brightness } : {}),
  };
};

export const hasExpectedPowerState = (summary: StateSummary, action: 'on' | 'off') =>
  summary.state_after === action;

export const writeAudit = async (auditLogger: AuditLogger, event: AuditEvent) => {
  await auditLogger.write(event);
};
