import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { geoidHeightM } from './geoid.js';
import { openMeteoHourlyFields, parseOpenMeteo, withLevelsFrom } from './open-meteo.js';

/**
 * Разбор Open-Meteo на реальных ответах по Уш-Коныру (fixtures/forecast,
 * 29.09.2026, 72 часа). Эталон — сам JSON: значения сверяются с исходными
 * полями, высоты — плюс геоид EGM96 в точке ответа.
 */

const FIXTURES = new URL('../../../fixtures/forecast/', import.meta.url);
type OpenMeteoJson = Record<string, unknown> & { hourly: Record<string, unknown[]> };
const raw = (model: string): OpenMeteoJson => JSON.parse(readFileSync(new URL(`ush-konyr.${model}.json`, FIXTURES), 'utf8')) as OpenMeteoJson;

describe('parseOpenMeteo на реальных ответах', () => {
  it('GFS: 72 часа, все поля, высоты уровней — над эллипсоидом', () => {
    const json = raw('gfs_seamless');
    const { series, warnings } = parseOpenMeteo(json, 'gfs');
    if (!series) throw new Error('series expected');
    expect(warnings).toEqual([]);
    expect(series.hours).toHaveLength(72);
    const geoid = geoidHeightM(json.latitude as number, json.longitude as number);
    expect(series.surfaceM).toBe((json.elevation as number) + geoid);

    const hour = series.hours[12];
    if (!hour) throw new Error('hour expected');
    expect(hour.timeMs).toBe(Date.UTC(2026, 8, 29, 12));
    expect(hour.temperatureC).toBe(json.hourly.temperature_2m?.[12]);
    expect(hour.windSpeedMs).toBe(json.hourly.wind_speed_10m?.[12]);
    expect(hour.sensibleHeatFluxWm2).toBe(json.hourly.sensible_heat_flux?.[12]);
    expect(hour.levels.map((l) => l.hPa)).toEqual([1000, 925, 850, 800, 700, 600, 500]);
    const level700 = hour.levels.find((l) => l.hPa === 700);
    expect(level700?.heightM).toBe((json.hourly.geopotential_height_700hPa?.[12] as number) + geoid);
    expect(level700?.windDirDeg).toBe(json.hourly.wind_direction_700hPa?.[12]);
  });

  it('ECMWF 9 км без уровней давления; склейка с 0,25° даёт уровни без 800 гПа', () => {
    const surface = parseOpenMeteo(raw('ecmwf_ifs'), 'ecmwf').series;
    const upper = parseOpenMeteo(raw('ecmwf_ifs025'), 'ecmwf').series;
    if (!surface || !upper) throw new Error('series expected');
    expect(surface.hours.every((h) => h.levels.length === 0)).toBe(true);
    expect(surface.hours[12]?.liftedIndex).toBeNull();
    const merged = withLevelsFrom(surface, upper);
    expect(merged.hours).toHaveLength(72);
    expect(merged.hours[12]?.temperatureC).toBe(surface.hours[12]?.temperatureC);
    expect(merged.hours[12]?.levels.map((l) => l.hPa)).toEqual([1000, 925, 850, 700, 600, 500]);
  });

  it('ICON: индекса устойчивости и пограничного слоя нет — null, а не 0', () => {
    const series = parseOpenMeteo(raw('icon_global'), 'icon').series;
    expect(series?.hours[0]?.liftedIndex).toBeNull();
    expect(series?.hours[0]?.boundaryLayerM).toBeNull();
    expect(series?.hours[0]?.capeJkg).not.toBeNull();
  });

  it('поток тепла — вверх положительный: у ICON знак перевёрнут, днём прогрев у обеих моделей', () => {
    // 30.09 06:00 UTC — полдень по Алматы.
    const noon = Date.UTC(2026, 8, 30, 6);
    const icon = parseOpenMeteo(raw('icon_global'), 'icon').series?.hours.find((h) => h.timeMs === noon);
    const gfs = parseOpenMeteo(raw('gfs_seamless'), 'gfs').series?.hours.find((h) => h.timeMs === noon);
    const rawIcon = raw('icon_global').hourly.sensible_heat_flux?.[30] as number;
    expect(rawIcon).toBeLessThan(0);
    expect(icon?.sensibleHeatFluxWm2).toBe(-rawIcon);
    expect(gfs?.sensibleHeatFluxWm2).toBeGreaterThan(0);
  });
});

describe('parseOpenMeteo — кривые данные', () => {
  it('не бросает: чужая форма — series null и предупреждение', () => {
    expect(parseOpenMeteo(null, 'gfs')).toEqual({ series: null, warnings: [{ code: 'bad_shape' }] });
    expect(parseOpenMeteo({ hourly: {} }, 'gfs').series).toBeNull();
    expect(parseOpenMeteo({ latitude: 1, longitude: 1, elevation: 1, hourly: { time: [] }, hourly_units: { wind_speed_10m: 'km/h' } }, 'gfs')).toEqual({
      series: null,
      warnings: [{ code: 'wind_units' }],
    });
  });

  it('час без обязательного поля пропускается с предупреждением, остальные на месте', () => {
    const json = raw('gfs_seamless');
    const broken = { ...json, hourly: { ...json.hourly, temperature_2m: json.hourly.temperature_2m?.map((v, i) => (i === 5 ? null : v)) } };
    const { series, warnings } = parseOpenMeteo(broken, 'gfs');
    expect(series?.hours).toHaveLength(71);
    expect(warnings).toEqual([{ code: 'hour_incomplete', hour: 5 }]);
  });

  it('запрос просит все поля, которые разбирает парсер', () => {
    const fields = openMeteoHourlyFields();
    expect(fields).toContain('geopotential_height_700hPa');
    expect(fields).toContain('sensible_heat_flux');
    expect(new Set(fields).size).toBe(fields.length);
  });
});
