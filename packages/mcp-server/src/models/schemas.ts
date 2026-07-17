import { z } from 'zod';

export const listDevicesInputSchema = z.object({
  domain: z.string().optional(),
  room: z.string().optional(),
  keyword: z.string().optional(),
  enabled_only: z.boolean().optional(),
});

export const resolveDeviceInputSchema = z.object({
  query: z.string().min(1),
  domain: z.string().optional(),
  room: z.string().optional(),
});

export const getDeviceStateInputSchema = z.object({
  entity_id: z.string().min(1),
});

export const controlDeviceInputSchema = z.object({
  entity_id: z.string().min(1).optional(),
  device_name: z.string().min(1).optional(),
  action: z.enum(['turn_on', 'turn_off', 'press', 'set_brightness', 'set_color_temp', 'set_value', 'set_temperature', 'set_hvac_mode', 'set_fan_mode', 'set_swing_mode']),
  brightness: z.coerce.number().finite().optional(),
  color_temp_kelvin: z.coerce.number().finite().int().min(1000).max(10000).optional(),
  value: z.coerce.number().finite().optional(),
  temperature: z.coerce.number().finite().optional(),
  hvac_mode: z.enum(['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only']).optional(),
  fan_mode: z.string().min(1).optional(),
  swing_mode: z.string().min(1).optional(),
});

export const listLightsInputSchema = z.object({
  room: z.string().optional(),
  keyword: z.string().optional(),
  support_brightness: z.boolean().optional(),
});

export const resolveLightInputSchema = z.object({
  query: z.string().min(1),
});

export const getLightStateInputSchema = z.object({
  entity_id: z.string().min(1),
});

export const turnOnLightInputSchema = z.object({
  entity_id: z.string().min(1),
});

export const turnOffLightInputSchema = z.object({
  entity_id: z.string().min(1),
});

const brightnessSchema = z.coerce.number().finite().transform((value) => Math.round(value)).pipe(z.number().int().min(0).max(255));

export const setLightBrightnessInputSchema = z.object({
  entity_id: z.string().min(1),
  brightness: brightnessSchema,
});

export const setLightColorTempInputSchema = z.object({
  entity_id: z.string().min(1),
  color_temp_kelvin: z.coerce.number().finite().int().min(1000).max(10000),
});

export const setLightStateInputSchema = z.object({
  entity_id: z.string().min(1),
  state: z.enum(['on', 'off']),
  brightness: brightnessSchema.optional(),
  color_temp_kelvin: z.coerce.number().finite().int().min(1000).max(10000).optional(),
});

export const pressButtonInputSchema = z.object({
  entity_id: z.string().min(1),
});

export const setNumberValueInputSchema = z.object({
  entity_id: z.string().min(1),
  value: z.number(),
});

export const turnOnSwitchInputSchema = z.object({
  entity_id: z.string().min(1),
});

export const turnOffSwitchInputSchema = z.object({
  entity_id: z.string().min(1),
});

export const listClimateDevicesInputSchema = z.object({
  room: z.string().optional(),
  keyword: z.string().optional(),
});

export const setClimateTemperatureInputSchema = z.object({
  entity_id: z.string().min(1),
  temperature: z.number(),
});

export const setClimateHvacModeInputSchema = z.object({
  entity_id: z.string().min(1),
  hvac_mode: z.enum(['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only']),
});

export const setClimateFanModeInputSchema = z.object({
  entity_id: z.string().min(1),
  fan_mode: z.string().min(1),
});

export const setClimateSwingModeInputSchema = z.object({
  entity_id: z.string().min(1),
  swing_mode: z.string().min(1),
});
