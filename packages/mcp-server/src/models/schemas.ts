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