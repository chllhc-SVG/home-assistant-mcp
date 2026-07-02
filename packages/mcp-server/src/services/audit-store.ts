import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import type { AuditEvent, AuditQuery, AuditSummary } from '../models/types.js';

export interface AuditPage {
  items: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const legacyJsonPath = resolve(process.env.AUDIT_JSON_PATH ?? 'data/audit-log.json');

if (!connectionString) {
  throw new Error('DATABASE_URL or POSTGRES_URL is required for audit log storage');
}

const pool = new Pool({ connectionString });

const ensureTable = async () => {
  await pool.query(`
    create table if not exists audit_logs (
      id text primary key,
      request_id text not null unique,
      timestamp timestamptz not null,
      source text not null,
      tool_name text not null,
      user_input text,
      intent text,
      resolved_device jsonb,
      tool_args jsonb not null,
      ha_request jsonb,
      ha_response jsonb,
      result jsonb not null,
      duration_ms integer,
      device_id text,
      entity_id text,
      error_code text,
      result_status text,
      created_at timestamptz not null default now()
    )
  `);
};

void ensureTable();

const normalize = (event: AuditEvent): AuditEvent => ({
  ...event,
  id: event.id ?? event.request_id ?? randomUUID(),
  entity_id: event.entity_id ?? event.resolved_device?.entity_id,
  device_id: event.device_id ?? event.resolved_device?.entity_id,
  error_code: event.error_code ?? event.result.error_code,
  result_status: event.result_status ?? (event.result.success ? 'success' : 'failure'),
});

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

const toRecord = (row: Record<string, unknown>): AuditEvent => ({
  ...(row as unknown as AuditEvent),
  resolved_device: row.resolved_device as AuditEvent['resolved_device'],
  tool_args: row.tool_args as Record<string, unknown>,
  ha_request: row.ha_request as Record<string, unknown> | undefined,
  ha_response: row.ha_response as Record<string, unknown> | undefined,
  result: row.result as AuditEvent['result'],
});

const readLegacyJsonEvents = (): AuditEvent[] => {
  if (!existsSync(legacyJsonPath)) return [];
  const raw = readFileSync(legacyJsonPath, 'utf8').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { records?: AuditEvent[] };
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
};

export const auditStore = {
  async push(event: AuditEvent) {
    const record = normalize(event);
    await pool.query(
      `insert into audit_logs (id, request_id, timestamp, source, tool_name, user_input, intent, resolved_device, tool_args, ha_request, ha_response, result, duration_ms, device_id, entity_id, error_code, result_status)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17)
       on conflict (request_id) do update set
         id = excluded.id,
         timestamp = excluded.timestamp,
         source = excluded.source,
         tool_name = excluded.tool_name,
         user_input = excluded.user_input,
         intent = excluded.intent,
         resolved_device = excluded.resolved_device,
         tool_args = excluded.tool_args,
         ha_request = excluded.ha_request,
         ha_response = excluded.ha_response,
         result = excluded.result,
         duration_ms = excluded.duration_ms,
         device_id = excluded.device_id,
         entity_id = excluded.entity_id,
         error_code = excluded.error_code,
         result_status = excluded.result_status`,
      [record.id, record.request_id, record.timestamp, record.source, record.tool_name, record.user_input ?? null, record.intent ?? null, JSON.stringify(record.resolved_device ?? null), JSON.stringify(record.tool_args), JSON.stringify(record.ha_request ?? null), JSON.stringify(record.ha_response ?? null), JSON.stringify(record.result), record.duration_ms ?? null, record.device_id ?? null, record.entity_id ?? null, record.error_code ?? null, record.result_status ?? null],
    );
  },
  async seed(events: AuditEvent[]) {
    const legacyEvents = readLegacyJsonEvents();
    const combined = [...legacyEvents, ...events];
    if (combined.length === 0) return;
    for (const event of combined) {
      await this.push(event);
    }
  },
  async query(query: AuditQuery = {}): Promise<AuditPage> {
    const pageSize = Math.max(1, Math.min(query.limit ?? 20, 100));
    const offset = query.offset ?? 0;
    const { rows } = await pool.query('select * from audit_logs order by timestamp desc');
    const records = rows.map((row) => toRecord(row));
    const filtered = records.filter((record) => matches(record, query));
    return { items: filtered.slice(offset, offset + pageSize), total: filtered.length, page: Math.floor(offset / pageSize) + 1, pageSize };
  },
  async list(query: AuditQuery = {}) {
    return (await this.query(query)).items;
  },
  async getByRequestId(requestId: string) {
    const { rows } = await pool.query('select * from audit_logs where request_id = $1 limit 1', [requestId]);
    return rows[0] ? toRecord(rows[0]) : undefined;
  },
  async summary(): Promise<AuditSummary> {
    const { rows } = await pool.query('select result from audit_logs');
    const total = rows.length;
    const success = rows.filter((row) => (row.result as AuditEvent['result']).success).length;
    const failure = total - success;
    return { total, success, failure, successRate: total === 0 ? 0 : Number(((success / total) * 100).toFixed(2)) };
  },
  async failureStats() {
    const { rows } = await pool.query('select result, error_code, tool_name from audit_logs where coalesce((result->>\'success\')::boolean, false) = false');
    const byErrorCode = rows.reduce<Record<string, number>>((acc, record) => {
      const result = record.result as AuditEvent['result'];
      const code = result.error_code ?? (record.error_code as string | null | undefined) ?? 'UNKNOWN';
      acc[code] = (acc[code] ?? 0) + 1;
      return acc;
    }, {});
    const byTool = rows.reduce<Record<string, number>>((acc, record) => {
      const toolName = record.tool_name as string;
      acc[toolName] = (acc[toolName] ?? 0) + 1;
      return acc;
    }, {});
    return { total: rows.length, byErrorCode, byTool };
  },
  async recent(): Promise<AuditEvent[]> {
    const { rows } = await pool.query('select * from audit_logs order by timestamp desc limit 10');
    return rows.map((row) => toRecord(row));
  },
  async all(): Promise<AuditEvent[]> {
    const { rows } = await pool.query('select * from audit_logs order by timestamp desc');
    return rows.map((row) => toRecord(row));
  },
};
