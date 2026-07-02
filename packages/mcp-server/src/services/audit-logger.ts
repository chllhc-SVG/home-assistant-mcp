import { randomUUID } from 'node:crypto';
import type { AuditEvent } from '../models/types.js';
import type { auditStore } from './audit-store.js';

export class AuditLogger {
  constructor(private readonly store: typeof auditStore) {}

  async write(event: AuditEvent) {
    this.store.push({
      ...event,
      id: event.id ?? randomUUID(),
      result_status: event.result_status ?? (event.result.success ? 'success' : 'failure'),
    });
    console.error(JSON.stringify(event));
  }
}
