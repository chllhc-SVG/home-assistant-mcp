import { z } from 'zod';

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

export const setLightBrightnessInputSchema = z.object({
  entity_id: z.string().min(1),
  brightness: z.number().int().min(0).max(255),
});

export const setLightStateInputSchema = z.object({
  entity_id: z.string().min(1),
  state: z.enum(['on', 'off']),
  brightness: z.number().int().min(0).max(255).optional(),
});

export const pressButtonInputSchema = z.object({
  entity_id: z.string().min(1),
});

export const setNumberValueInputSchema = z.object({
  entity_id: z.string().min(1),
  value: z.number(),
});

export const getDeviceStateInputSchema = z.object({
  entity_id: z.string().min(1),
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
