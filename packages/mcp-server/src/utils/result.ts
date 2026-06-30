import type { ToolResponse, ToolFailure } from '../models/types.js';

export const ok = <T>(data: T): ToolResponse<T> => ({ success: true, data, error: null });

export const fail = (
  error_code: ToolFailure['error']['error_code'],
  message: string,
  details: Record<string, unknown> = {},
): ToolFailure => ({ success: false, data: null, error: { error_code, message, details } });