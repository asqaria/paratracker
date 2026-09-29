import { z } from 'zod';

import {
  COMPASS_POINTS,
  FORECAST_CONFIDENCES,
  FORECAST_MODELS,
  FORECAST_REASONS,
  FORECAST_VERDICTS,
  STORM_RISKS,
} from './forecast.js';

/**
 * API прогноза (ТЗ §6.9, задача П.2): GET /api/v1/forecast — сводка мест для
 * карты, GET /api/v1/forecast/{slug} — место по часам. Единицы — СИ, время —
 * UTC ISO; местное время — по timezone места, только в UI.
 */

const Iso = z.iso.datetime();
const Degrees = z.number().min(0).max(360);

/** Атрибуция данных прогноза — обязательна (CC BY 4.0), показывается рядом с ним. */
export const FORECAST_ATTRIBUTION = 'Open-Meteo.com (CC BY 4.0) · ECMWF · NOAA GFS · DWD ICON';

export const ForecastSiteDto = z.object({
  slug: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  /** Над эллипсоидом, м. */
  elevationM: z.number().nullable(),
  timezone: z.string(),
  windSectors: z.array(z.enum(COMPASS_POINTS)),
  /** Допустимый ветер на старте, м/с — уже с умолчанием. */
  maxWindMs: z.number(),
  fetchedAt: Iso,
});
export type ForecastSiteDto = z.infer<typeof ForecastSiteDto>;

export const ModelVerdictDto = z.object({
  model: z.enum(FORECAST_MODELS),
  verdict: z.enum(FORECAST_VERDICTS),
  reasons: z.array(z.enum(FORECAST_REASONS)),
  windSpeedMs: z.number(),
  windDirDeg: Degrees,
  gustMs: z.number(),
  ceilingM: z.number().nullable(),
  cloudBaseM: z.number().nullable(),
  thermalMs: z.number().nullable(),
  stormRisk: z.enum(STORM_RISKS),
  upperWindMs: z.number(),
});
export type ModelVerdictDto = z.infer<typeof ModelVerdictDto>;

const ProfilePointDto = z.object({ heightM: z.number(), temperatureC: z.number(), speedMs: z.number(), dirDeg: Degrees });

export const ForecastHourDto = z.object({
  time: Iso,
  verdict: z.enum(FORECAST_VERDICTS),
  confidence: z.enum(FORECAST_CONFIDENCES),
  reasons: z.array(z.enum(FORECAST_REASONS)),
  /** Главная модель — первой. */
  models: z.array(ModelVerdictDto),
  ceilingRangeM: z.tuple([z.number(), z.number()]).nullable(),
  surface: ProfilePointDto,
  profile: z.array(ProfilePointDto),
  /** Нет у прогнозов до задачи П.7 — тогда ветер берётся из profile. */
  wind: z.array(ProfilePointDto).optional(),
  windModel: z.enum(FORECAST_MODELS).optional(),
  cloudCoverPct: z.number(),
  precipitationMm: z.number(),
});
export type ForecastHourDto = z.infer<typeof ForecastHourDto>;

/** Час на карте: цвет значка, стрелка ветра, потолок. */
export const ForecastMapHourDto = z.object({
  time: Iso,
  verdict: z.enum(FORECAST_VERDICTS),
  confidence: z.enum(FORECAST_CONFIDENCES),
  windSpeedMs: z.number(),
  windDirDeg: Degrees,
  ceilingM: z.number().nullable(),
});
export type ForecastMapHourDto = z.infer<typeof ForecastMapHourDto>;

export const ForecastMapResponse = z.object({
  sites: z.array(ForecastSiteDto.extend({ hours: z.array(ForecastMapHourDto) })),
  attribution: z.string(),
});
export type ForecastMapResponse = z.infer<typeof ForecastMapResponse>;

export const ForecastSiteResponse = z.object({
  site: ForecastSiteDto,
  hours: z.array(ForecastHourDto),
  attribution: z.string(),
});
export type ForecastSiteResponse = z.infer<typeof ForecastSiteResponse>;
