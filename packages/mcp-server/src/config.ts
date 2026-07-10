import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { DeviceExposureConfig, RoomControlProfile } from './models/types.js';

export interface AppConfig {
  homeAssistantBaseUrl: string;
  homeAssistantToken: string;
  timeoutMs: number;
  haRegistrySyncIntervalMs: number;
  databaseUrl: string;
  exposure: DeviceExposureConfig;
  roomControlProfiles: RoomControlProfile[];
}

const currentDir = dirname(fileURLToPath(import.meta.url));

const findUp = (start: string, marker: string) => {
  let cursor = resolve(start);
  while (true) {
    if (existsSync(resolve(cursor, marker))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
};

const resolveWorkspaceRoot = () => {
  return findUp(process.cwd(), 'pnpm-workspace.yaml') ?? findUp(currentDir, 'pnpm-workspace.yaml') ?? process.cwd();
};

const loadEnv = () => {
  const workspaceRoot = resolveWorkspaceRoot();
  const candidates = [
    resolve(workspaceRoot, '.env'),
    resolve(process.cwd(), '.env'),
    resolve(currentDir, '..', '..', '..', '.env'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  }
};

export const resolveLightsConfigPath = () => {
  if (process.env.LIGHTS_CONFIG_PATH) {
    return resolve(resolveWorkspaceRoot(), process.env.LIGHTS_CONFIG_PATH);
  }

  const workspaceRoot = resolveWorkspaceRoot();
  const candidates = [
    resolve(workspaceRoot, 'config', 'lights.json'),
    resolve(process.cwd(), 'config', 'lights.json'),
    resolve(currentDir, '..', '..', '..', 'config', 'lights.json'),
  ];

  const matched = candidates.find((candidate) => existsSync(candidate));
  if (!matched) {
    throw new Error(`lights.json not found. Tried: ${candidates.join(', ')}`);
  }

  return matched;
};

const loadRoomControlProfiles = () => {
  const workspaceRoot = resolveWorkspaceRoot();
  const configuredPath = process.env.ROOM_CONTROL_PROFILES_PATH;
  const path = configuredPath
    ? resolve(workspaceRoot, configuredPath)
    : resolve(workspaceRoot, 'config', 'room-control-profiles.json');

  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { profiles?: unknown };
  if (!Array.isArray(parsed.profiles)) return [];

  return parsed.profiles.flatMap((profile): RoomControlProfile[] => {
    if (!profile || typeof profile !== 'object') return [];
    const value = profile as Record<string, unknown>;
    const mainLight = value.main_light;
    if (typeof value.area_id !== 'string' || !mainLight || typeof mainLight !== 'object') return [];
    const mainLightValue = mainLight as Record<string, unknown>;
    const memberEntityIds = Array.isArray(mainLightValue.member_entity_ids)
      ? mainLightValue.member_entity_ids.filter((entityId): entityId is string => typeof entityId === 'string' && entityId.length > 0)
      : [];
    if (typeof mainLightValue.display_name !== 'string' || memberEntityIds.length === 0) return [];

    return [{
      area_id: value.area_id,
      main_light: {
        display_name: mainLightValue.display_name,
        aliases: Array.isArray(mainLightValue.aliases)
          ? mainLightValue.aliases.filter((alias): alias is string => typeof alias === 'string')
          : undefined,
        member_entity_ids: memberEntityIds,
        power_switch_entity_id: typeof mainLightValue.power_switch_entity_id === 'string'
          ? mainLightValue.power_switch_entity_id
          : undefined,
      },
    }];
  });
};

export const loadConfig = (): AppConfig => {
  loadEnv();

  const workspaceRoot = resolveWorkspaceRoot();
  const exposurePath = resolve(workspaceRoot, 'config', 'device-exposure.json');
  const exposure = existsSync(exposurePath)
    ? JSON.parse(readFileSync(exposurePath, 'utf8')) as DeviceExposureConfig
    : { rooms: [], devices: [] };
  const token = process.env.HOME_ASSISTANT_TOKEN ?? process.env.HA_TOKEN ?? '';

  if (!token) {
    throw new Error('HOME_ASSISTANT_TOKEN/HA_TOKEN is empty after loading .env. Please check workspace root .env.');
  }

  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is empty. Please configure Postgres connection for whitelist persistence.');
  }

  const configuredSyncIntervalMs = Number(process.env.HA_REGISTRY_SYNC_INTERVAL_MS ?? 300_000);
  const roomControlProfiles = loadRoomControlProfiles();

  return {
    homeAssistantBaseUrl: process.env.HOME_ASSISTANT_BASE_URL ?? 'http://192.168.150.11:8123',
    homeAssistantToken: token,
    timeoutMs: Number(process.env.HOME_ASSISTANT_TIMEOUT_MS ?? 15000),
    haRegistrySyncIntervalMs: Number.isFinite(configuredSyncIntervalMs) ? Math.max(30_000, configuredSyncIntervalMs) : 300_000,
    databaseUrl,
    exposure,
    roomControlProfiles,
  };
};

export const saveDeviceExposure = (payload: DeviceExposureConfig) => {
  const workspaceRoot = resolveWorkspaceRoot();
  const configDir = resolve(workspaceRoot, 'config');
  const exposurePath = resolve(configDir, 'device-exposure.json');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(exposurePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};
