import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { DeviceExposureConfig } from './models/types.js';

export interface AppConfig {
  homeAssistantBaseUrl: string;
  homeAssistantToken: string;
  timeoutMs: number;
  databaseUrl: string;
  exposure: DeviceExposureConfig;
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

  return {
    homeAssistantBaseUrl: process.env.HOME_ASSISTANT_BASE_URL ?? 'http://192.168.150.11:8123',
    homeAssistantToken: token,
    timeoutMs: Number(process.env.HOME_ASSISTANT_TIMEOUT_MS ?? 15000),
    databaseUrl,
    exposure,
  };
};

export const saveDeviceExposure = (payload: DeviceExposureConfig) => {
  const workspaceRoot = resolveWorkspaceRoot();
  const configDir = resolve(workspaceRoot, 'config');
  const exposurePath = resolve(configDir, 'device-exposure.json');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(exposurePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};
