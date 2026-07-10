import type { LightDevice } from '../models/types.js';
import { HaClient } from './ha-client.js';
import { LightRegistry } from './light-registry.js';
import { type WhitelistRecord, WhitelistStore } from './whitelist-store.js';

type HaSnapshot = Awaited<ReturnType<HaClient['discoverEntities']>>[number];

const toDevice = (record: WhitelistRecord, snapshot?: HaSnapshot): LightDevice => {
  const domain = (snapshot?.domain ?? record.domain) as LightDevice['domain'];

  return {
    device_id: snapshot?.device_id ?? record.device_id ?? record.entity_id,
    display_name: snapshot?.device_name ?? snapshot?.friendly_name ?? record.display_name ?? record.entity_id,
    aliases: [],
    entity_id: record.entity_id,
    domain,
    room: snapshot ? snapshot.area_name ?? '' : record.room,
    area_id: snapshot?.area_id ?? record.area_id,
    area_name: snapshot?.area_name ?? record.area_name,
    type: domain,
    state: snapshot?.state,
    friendly_name: snapshot?.friendly_name ?? record.friendly_name,
    supports_brightness: snapshot?.supports_brightness ?? false,
    supports_value: snapshot?.supports_value,
    supports_temperature: snapshot?.supports_temperature,
    supports_hvac_mode: snapshot?.supports_hvac_mode,
    supports_fan_mode: snapshot?.supports_fan_mode,
    supports_swing_mode: snapshot?.supports_swing_mode,
    value_min: snapshot?.value_min,
    value_max: snapshot?.value_max,
    value_step: snapshot?.value_step,
    temperature_min: snapshot?.temperature_min,
    temperature_max: snapshot?.temperature_max,
    temperature_step: snapshot?.temperature_step,
    temperature_unit: snapshot?.temperature_unit,
    current_temperature: snapshot?.current_temperature,
    target_temperature: snapshot?.target_temperature,
    hvac_mode: snapshot?.hvac_mode,
    hvac_modes: snapshot?.hvac_modes,
    fan_mode: snapshot?.fan_mode,
    fan_modes: snapshot?.fan_modes,
    swing_mode: snapshot?.swing_mode,
    swing_modes: snapshot?.swing_modes,
    sensor_unit: snapshot?.sensor_unit,
    sensor_value: snapshot?.sensor_value,
    supported_color_modes: snapshot?.supported_color_modes,
    color_mode: snapshot?.color_mode,
    color_temp_min_kelvin: snapshot?.color_temp_min_kelvin,
    color_temp_max_kelvin: snapshot?.color_temp_max_kelvin,
    brightness: snapshot?.brightness,
    capabilities: [],
    capability_source: snapshot ? 'home_assistant' : 'config',
    risk_level: 'low',
    enabled: record.enabled,
  };
};

export const hydrateRegistryFromWhitelist = (registry: LightRegistry, records: WhitelistRecord[]) => {
  registry.setExposure(records.filter((record) => record.enabled).map((record) => record.entity_id));
  registry.replace(records.map((record) => toDevice(record)));
};

export const syncDeviceRegistryFromHomeAssistant = async ({
  registry,
  haClient,
  whitelistStore,
}: {
  registry: LightRegistry;
  haClient: HaClient;
  whitelistStore: WhitelistStore;
}) => {
  const records = await whitelistStore.list();
  const snapshots = await haClient.discoverEntities();
  const snapshotsByEntityId = new Map(snapshots.map((snapshot) => [snapshot.entity_id, snapshot]));
  const syncedAt = new Date().toISOString();

  await whitelistStore.upsert(records.map((record) => {
    const snapshot = snapshotsByEntityId.get(record.entity_id);
    const device = toDevice(record, snapshot);

    return {
      entity_id: device.entity_id,
      display_name: device.display_name,
      friendly_name: device.friendly_name,
      device_id: device.device_id,
      device_name: snapshot?.device_name ?? record.device_name,
      domain: device.domain,
      room: device.room,
      area_id: snapshot ? snapshot.area_id : record.area_id,
      area_name: snapshot ? snapshot.area_name : record.area_name,
      enabled: record.enabled,
      ha_synced_at: syncedAt,
    };
  }));

  const syncedRecords = await whitelistStore.list();
  registry.setExposure(syncedRecords.filter((record) => record.enabled).map((record) => record.entity_id));
  registry.replace(syncedRecords.map((record) => toDevice(record, snapshotsByEntityId.get(record.entity_id))));

  return {
    synced_at: syncedAt,
    devices: registry.list({ enabledOnly: true }),
  };
};
