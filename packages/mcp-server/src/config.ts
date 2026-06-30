import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { LightDevice } from './models/types.js';

export interface AppConfig {
  homeAssistantBaseUrl: string;
  homeAssistantToken: string;
  timeoutMs: number;
  lights: LightDevice[];
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

const resolveLightsConfigPath = () => {
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

  const configPath = resolveLightsConfigPath();
  const raw = readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as { lights: LightDevice[] };
  const token = process.env.HOME_ASSISTANT_TOKEN ?? process.env.HA_TOKEN ?? '';

  if (!token) {
    throw new Error('HOME_ASSISTANT_TOKEN/HA_TOKEN is empty after loading .env. Please check workspace root .env.');
  }

  return {
    homeAssistantBaseUrl: process.env.HOME_ASSISTANT_BASE_URL ?? 'http://192.168.150.11:8123',
    homeAssistantToken: token,
    timeoutMs: Number(process.env.HOME_ASSISTANT_TIMEOUT_MS ?? 15000),
    lights: parsed.lights,
  };
};
