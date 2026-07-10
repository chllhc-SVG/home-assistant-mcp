import type { LightDevice, RoomControlProfile } from '../models/types.js';

const unique = (values: string[]) => Array.from(new Set(values));

export const findMainLightProfile = (
  profiles: RoomControlProfile[],
  device: Pick<LightDevice, 'entity_id' | 'area_id' | 'room'>,
) => {
  const areaId = device.area_id ?? device.room;
  return profiles.find((profile) =>
    profile.area_id === areaId && profile.main_light.member_entity_ids.includes(device.entity_id),
  );
};

export const getLightControlEntityIds = (profiles: RoomControlProfile[], device: LightDevice) => {
  const profile = findMainLightProfile(profiles, device);
  return unique(profile?.main_light.member_entity_ids ?? [device.entity_id]);
};

export const getLightControlKey = (profiles: RoomControlProfile[], device: LightDevice) => {
  const profile = findMainLightProfile(profiles, device);
  return profile ? `main-light:${profile.area_id}:${profile.main_light.member_entity_ids.join('|')}` : `light:${device.entity_id}`;
};

export const summarizeMainLightProfiles = (profiles: RoomControlProfile[], devices: LightDevice[]) => {
  const remaining = [...devices];
  const summarized: LightDevice[] = [];

  for (const profile of profiles) {
    const members = remaining.filter((device) => findMainLightProfile([profile], device));
    if (members.length === 0) continue;

    const representative = members.find((device) => device.entity_id === profile.main_light.member_entity_ids[0]) ?? members[0];
    summarized.push({
      ...representative,
      display_name: profile.main_light.display_name,
      aliases: unique([
        ...members.flatMap((device) => [device.display_name, ...device.aliases]),
        ...(profile.main_light.aliases ?? []),
      ]),
      supports_brightness: members.some((device) => device.supports_brightness),
      enabled: members.some((device) => device.enabled),
    });

    for (const member of members) {
      const index = remaining.findIndex((device) => device.entity_id === member.entity_id);
      if (index !== -1) remaining.splice(index, 1);
    }
  }

  return [...summarized, ...remaining];
};
