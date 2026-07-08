import { Pool } from 'pg';
import type { LightDevice } from '../models/types.js';

export interface WhitelistRecord {
  entity_id: string;
  display_name: string;
  friendly_name?: string;
  device_id: string;
  device_name?: string;
  domain: LightDevice['domain'];
  room: string;
  area_id?: string;
  area_name?: string;
  enabled: boolean;
  updated_at: string;
  created_at: string;
}

export type WhitelistUpsertRecord = Omit<WhitelistRecord, 'created_at' | 'updated_at'>;

export class WhitelistStore {
  private readonly pool: Pool;
  private initialized = false;

  constructor(databaseUrl: string) {
    if (!databaseUrl) throw new Error('DATABASE_URL is required for whitelist persistence.');
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async initialize() {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS whitelist_devices (
        entity_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        friendly_name TEXT,
        device_id TEXT NOT NULL,
        device_name TEXT,
        domain TEXT NOT NULL,
        room TEXT NOT NULL DEFAULT '',
        area_id TEXT,
        area_name TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    this.initialized = true;
  }

  async list(): Promise<WhitelistRecord[]> {
    await this.initialize();
    const result = await this.pool.query<WhitelistRecord>(`
      SELECT entity_id, display_name, friendly_name, device_id, device_name, domain, room, area_id, area_name, enabled, created_at::text, updated_at::text
      FROM whitelist_devices
      ORDER BY updated_at DESC, entity_id ASC
    `);
    return result.rows;
  }

  async upsert(records: WhitelistUpsertRecord[]) {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const record of records) {
        await client.query(
          `INSERT INTO whitelist_devices (entity_id, display_name, friendly_name, device_id, device_name, domain, room, area_id, area_name, enabled, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
           ON CONFLICT (entity_id) DO UPDATE SET
             display_name = EXCLUDED.display_name,
             friendly_name = EXCLUDED.friendly_name,
             device_id = EXCLUDED.device_id,
             device_name = EXCLUDED.device_name,
             domain = EXCLUDED.domain,
             room = EXCLUDED.room,
             area_id = EXCLUDED.area_id,
             area_name = EXCLUDED.area_name,
             enabled = EXCLUDED.enabled,
             updated_at = NOW()`,
          [
            record.entity_id,
            record.display_name,
            record.friendly_name ?? null,
            record.device_id,
            record.device_name ?? null,
            record.domain,
            record.room,
            record.area_id ?? null,
            record.area_name ?? null,
            record.enabled,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(entityIds: string[]) {
    await this.initialize();
    if (entityIds.length === 0) return;
    await this.pool.query('DELETE FROM whitelist_devices WHERE entity_id = ANY($1::text[])', [entityIds]);
  }

  async close() { await this.pool.end(); }
}
