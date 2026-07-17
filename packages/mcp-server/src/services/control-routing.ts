import type { Runtime } from '../runtime.js';
import type { LightDevice } from '../models/types.js';

export type ControlRoute =
  | 'climate'
  | 'main_light_brightness'
  | 'main_light_power'
  | 'light_group_power'
  | 'switch_power'
  | 'fallback';

export type ControlIntentClassification = ReturnType<typeof classifyControlIntent>;

export const classifyControlIntent = (intent: string) => {
  const normalizedIntent = intent.toLowerCase().replace(/[\s_\-]+/g, ' ');
  return {
    normalizedIntent,
    hasClimateIntent: /空调|温度|制冷|制热|恒温|温控|多少度|几度/.test(normalizedIntent),
    hasMainLightIntent: /主灯|main light|mainlight/.test(normalizedIntent),
    hasMainLightBrightnessIntent: /主灯|main light|mainlight|灯光|亮度|调亮|调暗|变亮|变暗/.test(normalizedIntent),
    hasLightGroupIntent: /灯带|灯条|筒灯|strip|downlight/.test(normalizedIntent),
    hasSwitchIntent: /开|关|打开|关闭|turn on|turn off|switch|toggle/.test(normalizedIntent),
  };
};

export const classifyRoute = (_classification: ControlIntentClassification, action: string): ControlRoute => {
  if (action === 'set_temperature') return 'climate';
  if (action === 'set_brightness') return 'main_light_brightness';
  if (action === 'turn_on' || action === 'turn_off') return 'switch_power';
  return 'fallback';
};

const resolveClimateDevice = (runtime: Runtime, keyword?: string) => {
  const candidates = runtime.registry.list({ domain: 'climate', keyword, enabledOnly: true });
  return candidates[0] ?? runtime.registry.list({ domain: 'climate', enabledOnly: true })[0];
};

const normalizeText = (value: string) => value.toLowerCase().replace(/[\s_\-]+/g, ' ').trim();

const exactNameScore = (device: LightDevice, terms: string[]) => {
  const nameParts = [device.display_name, device.entity_id, device.friendly_name ?? '', device.room ?? '', device.area_name ?? '', ...device.aliases].map(normalizeText);
  return terms.some((term) => nameParts.some((part) => part === normalizeText(term) || part.includes(normalizeText(term)))) ? 1 : 0;
};

const pickByExactLabel = (devices: LightDevice[], labels: RegExp[]) => {
  const exact = devices.find((device) => {
    const haystack = [device.display_name, device.entity_id, device.friendly_name ?? '', ...device.aliases].join(' ').toLowerCase();
    return labels.some((label) => label.test(haystack));
  });
  return exact;
};

const isIndicatorStyleDevice = (device: LightDevice) => {
  const haystack = [device.display_name, device.entity_id, device.friendly_name ?? '', device.room ?? '', device.area_name ?? '', ...device.aliases].join(' ').toLowerCase();
  return /指示灯|状态灯|indicator|all[_\s-]*switch|left[_\s-]*switch|right[_\s-]*switch/.test(haystack);
};

const directNameMatches = (devices: LightDevice[], terms: string[]) => devices.filter((device) => exactNameScore(device, terms) === 1);

const resolveDirectNamedTarget = (runtime: Runtime, searchKey: string, domain: 'switch' | 'light' | 'climate', terms: string[]) => {
  const candidates = runtime.registry.resolve(searchKey, { domain }).filter((device) => !isIndicatorStyleDevice(device));
  const exact = directNameMatches(candidates, terms);
  return exact.length === 1 ? exact[0] : undefined;
};

const resolveSwitchTarget = (runtime: Runtime, searchKey: string, hints: RegExp[], terms: string[]) => {
  const direct = resolveDirectNamedTarget(runtime, searchKey, 'switch', terms);
  if (direct) return direct;
  const candidates = runtime.registry.resolve(searchKey, { domain: 'switch' }).filter((device) => !isIndicatorStyleDevice(device));
  return pickByExactLabel(candidates, hints) ?? undefined;
};

export const resolveWhitelistEntity = (runtime: Runtime, params: { entityId?: string; deviceName?: string; keyword?: string; intent?: string }) => {
  const searchTerms = [params.entityId, params.deviceName, params.keyword, params.intent].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  for (const term of searchTerms) {
    const exact = runtime.registry.getByEntityId(term);
    if (exact) return exact;
  }

  for (const term of searchTerms) {
    const direct = runtime.registry.resolve(term, {}).filter((device) => device.enabled);
    if (direct.length === 1) return direct[0];
  }

  const hinted = searchTerms.join(' ');
  if (/空调|温度|制冷|制热|恒温|温控|多少度|几度/.test(hinted)) return resolveDirectNamedTarget(runtime, params.keyword ?? hinted, 'climate', ['空调', 'climate']);
  if (/主灯|main light|mainlight/.test(hinted)) return resolveSwitchTarget(runtime, params.keyword ?? hinted, [/主灯/, /main light/, /mainlight/], ['主灯', 'main light', 'mainlight']);
  if (/灯带|灯条|筒灯|strip|downlight/.test(hinted)) return resolveSwitchTarget(runtime, params.keyword ?? hinted, [/筒灯/, /灯带/, /灯条/, /strip/, /downlight/], ['筒灯', '灯带', '灯条', 'strip', 'downlight']);
  if (/开|关|打开|关闭|turn on|turn off|switch|toggle/.test(hinted)) return resolveSwitchTarget(runtime, params.keyword ?? hinted, [/开关/, /switch/, /toggle/, /turn on/, /turn off/], ['开关', 'switch', 'toggle', 'turn on', 'turn off']);
  return undefined;
};

export const resolveControlTarget = (
  runtime: Runtime,
  entityId: string,
  intent: string,
  _room?: string,
  keyword?: string,
) => {
  const classification = classifyControlIntent(intent);
  const searchKey = keyword ?? entityId;
  if (classification.hasClimateIntent) return resolveClimateDevice(runtime, keyword);
  if (classification.hasMainLightIntent) {
    return resolveSwitchTarget(runtime, searchKey, [/主灯/, /main light/, /mainlight/], ['主灯', 'main light', 'mainlight']);
  }
  if (classification.hasLightGroupIntent) {
    return resolveSwitchTarget(runtime, searchKey, [/筒灯/, /灯带/, /灯条/, /strip/, /downlight/], ['筒灯', '灯带', '灯条', 'strip', 'downlight']);
  }
  if (classification.hasSwitchIntent) {
    return resolveSwitchTarget(runtime, searchKey, [/开关/, /switch/, /toggle/, /turn on/, /turn off/], ['开关', 'switch', 'toggle', 'turn on', 'turn off']);
  }
  return undefined;
};

export const executePowerControl = async (runtime: Runtime, action: 'turn_on' | 'turn_off', target: LightDevice) =>
  action === 'turn_on'
    ? runtime.tools.turn_on_switch({ entity_id: target.entity_id })
    : runtime.tools.turn_off_switch({ entity_id: target.entity_id });

export const executeLightControl = async (runtime: Runtime, action: 'turn_on' | 'turn_off', target: LightDevice) =>
  action === 'turn_on'
    ? runtime.tools.turn_on_light({ entity_id: target.entity_id })
    : runtime.tools.turn_off_light({ entity_id: target.entity_id });
