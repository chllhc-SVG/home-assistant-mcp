import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AuditEvent, AuditQuery, AuditSummary } from '../models/types.js';

export interface AuditPage {
  items: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}

const dbPath = resolve(process.env.AUDIT_DB_PATH ?? 'data/audit-log.json');

const ensureParentDir = () => {
  mkdirSync(dirname(dbPath), { recursive: true });
};

const readRecords = (): AuditEvent[] => {
  if (!existsSync(dbPath)) return [];
  const raw = readFileSync(dbPath, 'utf8').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { records?: AuditEvent[] };
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
};

const writeRecords = (records: AuditEvent[]) => {
  ensureParentDir();
  writeFileSync(dbPath, JSON.stringify({ records }, null, 2), 'utf8');
};

const records: AuditEvent[] = readRecords();

const inRange = (timestamp: string, from?: string, to?: string) => {
  const ts = new Date(timestamp).getTime();
  if (from && ts < new Date(from).getTime()) return false;
  if (to && ts > new Date(to).getTime()) return false;
  return true;
};

const matches = (record: AuditEvent, query: AuditQuery) => {
  if (query.keyword) {
    const keyword = query.keyword.toLowerCase();
    const haystack = JSON.stringify(record).toLowerCase();
    if (!haystack.includes(keyword)) return false;
  }
  if (query.tool_name && record.tool_name !== query.tool_name) return false;
  if (query.device_name && record.resolved_device?.display_name !== query.device_name) return false;
  if (query.status && (query.status === 'success' ? !record.result.success : record.result.success)) return false;
  if (!inRange(record.timestamp, query.from, query.to)) return false;
  return true;
};

const normalize = (event: AuditEvent): AuditEvent => ({
  ...event,
  id: event.id ?? event.request_id,
  entity_id: event.entity_id ?? event.resolved_device?.entity_id,
  device_id: event.device_id ?? event.resolved_device?.entity_id,
  error_code: event.error_code ?? event.result.error_code,
  result_status: event.result_status ?? (event.result.success ? 'success' : 'failure'),
});

export const auditStore = {
  push(event: AuditEvent) {
    records.unshift(normalize(event));
    writeRecords(records);
  },
  seed(events: AuditEvent[]) {
    if (records.length === 0 && events.length > 0) {
      records.unshift(...events.reverse().map(normalize));
      writeRecords(records);
    }
  },
  query(query: AuditQuery = {}): AuditPage {
    const pageSize = Math.max(1, Math.min(query.limit ?? 20, 100));
    const offset = query.offset ?? 0;
    const filtered = records.filter((record) => matches(record, query));
    return {
      items: filtered.slice(offset, offset + pageSize),
      total: filtered.length,
      page: Math.floor(offset / pageSize) + 1,
      pageSize,
    };
  },
  list(query: AuditQuery = {}) {
    return this.query(query).items;
  },
  getByRequestId(requestId: string) {
    return records.find((record) => record.request_id === requestId);
  },
  summary(): AuditSummary {
    const total = records.length;
    const success = records.filter((record) => record.result.success).length;
    const failure = total - success;
    return {
      total,
      success,
      failure,
      successRate: total === 0 ? 0 : Number(((success / total) * 100).toFixed(2)),
    };
  },
  failureStats() {
    const failureRecords = records.filter((record) => !record.result.success);
    const byErrorCode = failureRecords.reduce<Record<string, number>>((acc, record) => {
      const code = record.result.error_code ?? record.error_code ?? 'UNKNOWN';
      acc[code] = (acc[code] ?? 0) + 1;
      return acc;
    }, {});
    const byTool = failureRecords.reduce<Record<string, number>>((acc, record) => {
      acc[record.tool_name] = (acc[record.tool_name] ?? 0) + 1;
      return acc;
    }, {});
    return { total: failureRecords.length, byErrorCode, byTool };
  },
  recent(): AuditEvent[] {
    return records.slice(0, 10);
  },
  all(): AuditEvent[] {
    return [...records];
  },
};
