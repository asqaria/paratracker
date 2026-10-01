import type { ForecastModel, ModelHour, ModelSeries, PressureLevel } from '@skyline/core';

import { geoidHeightM } from './geoid.js';

/**
 * Ответ Open-Meteo /v1/forecast (одна модель, почасово, timezone=GMT,
 * wind_speed_unit=ms) → ModelSeries (ТЗ §6.9). Как и парсеры треков, не бросает
 * исключений на кривых данных: час без обязательных полей пропускается с
 * предупреждением, чужая форма ответа — series: null.
 *
 * Высоты Open-Meteo (elevation, geopotential_height) — над уровнем моря;
 * внутри системы — над эллипсоидом WGS84: h = H + N (EGM96), как у IGC с HFALG:GEO.
 */

/**
 * Уровни давления, которые запрашивает воркер: от долин до ~5,5 км. 750, 650
 * и 550 гПа есть только у GFS — по ним ветер на высотах полёта каждые ~500 м
 * (задача П.7); у кого их нет, те просто пропускаются.
 */
export const OPEN_METEO_LEVELS_HPA = [1000, 925, 850, 800, 750, 700, 650, 600, 550, 500] as const;

/** Приземные поля запроса; без первых семи час не оценить. */
export const OPEN_METEO_SURFACE_FIELDS = [
  'temperature_2m',
  'dew_point_2m',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'precipitation',
  'cloud_cover',
  'cape',
  'lifted_index',
  'sensible_heat_flux',
  'boundary_layer_height',
] as const;

const REQUIRED = OPEN_METEO_SURFACE_FIELDS.slice(0, 7);
const LEVEL_FIELDS = ['temperature', 'wind_speed', 'wind_direction', 'geopotential_height'] as const;

/** Все поля hourly для запроса. */
export const openMeteoHourlyFields = (): string[] => [
  ...OPEN_METEO_SURFACE_FIELDS,
  ...OPEN_METEO_LEVELS_HPA.flatMap((hPa) => LEVEL_FIELDS.map((field) => `${field}_${hPa}hPa`)),
];

export type OpenMeteoWarningCode = 'bad_shape' | 'wind_units' | 'hour_incomplete';

export interface OpenMeteoWarning {
  code: OpenMeteoWarningCode;
  /** Индекс часа в ответе. */
  hour?: number;
}

export interface OpenMeteoParse {
  series: ModelSeries | null;
  warnings: OpenMeteoWarning[];
}

/**
 * Поток тепла — положительный вверх. ICON отдаёт его с обратным знаком (днём
 * −150…−170 Вт/м², ночью плюс; GFS в те же часы +190 и минус) — переворачиваем.
 */
const upwardFlux = (model: ForecastModel, value: number | null): number | null =>
  value === null ? null : model === 'icon' ? -value : value;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function parseOpenMeteo(json: unknown, model: ForecastModel): OpenMeteoParse {
  const warnings: OpenMeteoWarning[] = [];
  if (!isRecord(json) || !isRecord(json.hourly) || !Array.isArray(json.hourly.time)) {
    return { series: null, warnings: [{ code: 'bad_shape' }] };
  }
  const lat = num(json.latitude);
  const lon = num(json.longitude);
  const elevation = num(json.elevation);
  if (lat === null || lon === null || elevation === null) return { series: null, warnings: [{ code: 'bad_shape' }] };
  const units = isRecord(json.hourly_units) ? json.hourly_units.wind_speed_10m : undefined;
  if (units !== undefined && units !== 'm/s') return { series: null, warnings: [{ code: 'wind_units' }] };

  const hourly = json.hourly;
  const times: unknown[] = Array.isArray(hourly.time) ? hourly.time : [];
  const column = (name: string): unknown[] => {
    const value = hourly[name];
    return Array.isArray(value) ? value : [];
  };
  const at = (name: string, i: number): number | null => num(column(name)[i]);
  const geoidM = geoidHeightM(lat, lon);

  const hours: ModelHour[] = [];
  times.forEach((time, i) => {
    // timezone=GMT: время без зоны — это UTC.
    const timeMs = typeof time === 'string' ? Date.parse(`${time}Z`) : Number.NaN;
    const required = REQUIRED.map((name) => at(name, i));
    if (!Number.isFinite(timeMs) || required.some((value) => value === null)) {
      warnings.push({ code: 'hour_incomplete', hour: i });
      return;
    }
    const [temperatureC, dewPointC, windSpeedMs, windDirDeg, gustMs, precipitationMm, cloudCoverPct] = required as number[];
    const levels: PressureLevel[] = [];
    for (const hPa of OPEN_METEO_LEVELS_HPA) {
      const t = at(`temperature_${hPa}hPa`, i);
      const speed = at(`wind_speed_${hPa}hPa`, i);
      const dir = at(`wind_direction_${hPa}hPa`, i);
      const height = at(`geopotential_height_${hPa}hPa`, i);
      if (t === null || speed === null || dir === null || height === null) continue;
      levels.push({ hPa, heightM: height + geoidM, temperatureC: t, windSpeedMs: speed, windDirDeg: dir });
    }
    levels.sort((a, b) => a.heightM - b.heightM);
    hours.push({
      timeMs,
      temperatureC: temperatureC ?? Number.NaN,
      dewPointC: dewPointC ?? Number.NaN,
      windSpeedMs: windSpeedMs ?? Number.NaN,
      windDirDeg: windDirDeg ?? Number.NaN,
      gustMs: gustMs ?? Number.NaN,
      precipitationMm: precipitationMm ?? Number.NaN,
      cloudCoverPct: cloudCoverPct ?? Number.NaN,
      capeJkg: at('cape', i),
      liftedIndex: at('lifted_index', i),
      sensibleHeatFluxWm2: upwardFlux(model, at('sensible_heat_flux', i)),
      boundaryLayerM: at('boundary_layer_height', i),
      levels,
    });
  });
  return { series: { model, surfaceM: elevation + geoidM, hours }, warnings };
}

/**
 * ECMWF через Open-Meteo — две модели: IFS 9 км (приземные поля, без уровней
 * давления) и IFS 0,25° (уровни давления). Склейка: часы и приземные поля —
 * первой, уровни — второй того же часа.
 */
export function withLevelsFrom(surface: ModelSeries, upper: ModelSeries): ModelSeries {
  const levelsAt = new Map(upper.hours.map((hour) => [hour.timeMs, hour.levels]));
  return {
    ...surface,
    hours: surface.hours.map((hour) => (hour.levels.length > 0 ? hour : { ...hour, levels: levelsAt.get(hour.timeMs) ?? [] })),
  };
}
