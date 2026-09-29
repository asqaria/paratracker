import { readFileSync } from 'node:fs';

import { FORECAST, type ForecastSite, type ModelHour, type ModelSeries } from '@skyline/core';
import { parseOpenMeteo, withLevelsFrom } from '@skyline/parsing';
import { describe, expect, it } from 'vitest';

import { cloudBase, evaluateForecast, evaluateModelHour, inSector, stormRisk, thermalCeiling, thermalStrength, thermalTop } from './forecast.js';

/**
 * Прогноз для пилотов (ТЗ §6.9). Формулы — на синтетике с эталоном «на
 * бумаге»; целиком — на реальных ответах Open-Meteo по Уш-Коныру
 * (fixtures/forecast, 29.09.2026).
 */

const SURFACE_M = 2000;

const hour = (patch: Partial<ModelHour> = {}): ModelHour => ({
  timeMs: Date.UTC(2026, 8, 29, 8),
  temperatureC: 20,
  dewPointC: 5,
  windSpeedMs: 3,
  windDirDeg: 0,
  gustMs: 5,
  precipitationMm: 0,
  cloudCoverPct: 20,
  capeJkg: 50,
  liftedIndex: 5,
  sensibleHeatFluxWm2: 200,
  boundaryLayerM: null,
  // Парцель с 20 °C: на 3000 м — 10,2 °C (теплее среды на 2,2), на 4000 м — 0,4 °C (холоднее на 4,6).
  levels: [
    { hPa: 700, heightM: 3000, temperatureC: 8, windSpeedMs: 6, windDirDeg: 270 },
    { hPa: 600, heightM: 4000, temperatureC: 5, windSpeedMs: 9, windDirDeg: 260 },
  ],
  ...patch,
});

const site: ForecastSite = { elevationM: SURFACE_M, windSectors: ['N', 'NE', 'NW'], maxWindMs: null };

describe('формулы', () => {
  it('потолок термиков — где сухая адиабата от земли догоняет профиль (линейно между уровнями)', () => {
    const lapse = FORECAST.dryLapseCPerM;
    const at3000 = 20 - lapse * 1000 - 8;
    const at4000 = 20 - lapse * 2000 - 5;
    expect(thermalTop(hour(), SURFACE_M)).toBeCloseTo(3000 + (1000 * at3000) / (at3000 - at4000), 9);
  });

  it('устойчивое утро (инверсия) — потолок у земли; неустойчиво до верха — верхний уровень', () => {
    const inversion = hour({ levels: [{ hPa: 700, heightM: 3000, temperatureC: 15, windSpeedMs: 2, windDirDeg: 0 }] });
    expect(thermalTop(inversion, SURFACE_M)).toBe(SURFACE_M);
    const unstable = hour({ levels: [{ hPa: 700, heightM: 3000, temperatureC: -5, windSpeedMs: 2, windDirDeg: 0 }] });
    expect(thermalTop(unstable, SURFACE_M)).toBe(3000);
    expect(thermalTop(hour({ levels: [] }), SURFACE_M)).toBeNull();
  });

  it('потолок: пограничный слой модели, если он есть; иначе — сухая адиабата', () => {
    expect(thermalCeiling(hour({ boundaryLayerM: 1400 }), SURFACE_M)).toBe(SURFACE_M + 1400);
    expect(thermalCeiling(hour(), SURFACE_M)).toBe(thermalTop(hour(), SURFACE_M));
  });

  it('база кучёвки по Эспи: 125 м на градус между температурой и точкой росы', () => {
    expect(cloudBase(hour({ temperatureC: 20, dewPointC: 10 }), SURFACE_M)).toBe(SURFACE_M + 10 * FORECAST.espyMPerC);
  });

  it('сила термиков — w* Дирдорфа; без потока тепла — null, ночью — 0', () => {
    const depth = 1500;
    const expected = Math.cbrt(
      (FORECAST.gravityMs2 / (20 + FORECAST.celsiusToKelvin)) * (200 / (FORECAST.airDensityKgM3 * FORECAST.airHeatCapacityJkgK)) * depth,
    );
    expect(thermalStrength(hour(), depth)).toBeCloseTo(expected, 12);
    expect(thermalStrength(hour({ sensibleHeatFluxWm2: null }), depth)).toBeNull();
    expect(thermalStrength(hour({ sensibleHeatFluxWm2: -20 }), depth)).toBe(0);
  });

  it('сектор: каждый румб ±22,5°, через север без разрыва', () => {
    expect(inSector(350, ['N'])).toBe(true);
    expect(inSector(22.5, ['N'])).toBe(true);
    expect(inSector(23, ['N'])).toBe(false);
    expect(inSector(90, ['N', 'NE', 'NW'])).toBe(false);
    expect(inSector(315, ['N', 'NE', 'NW'])).toBe(true);
  });

  it('риск гроз: CAPE и индекс устойчивости', () => {
    expect(stormRisk(hour({ capeJkg: 1200, precipitationMm: 1 }))).toBe('high');
    expect(stormRisk(hour({ capeJkg: 1200, liftedIndex: -3 }))).toBe('high');
    expect(stormRisk(hour({ capeJkg: 400 }))).toBe('medium');
    expect(stormRisk(hour({ capeJkg: 50, liftedIndex: -1 }))).toBe('medium');
    expect(stormRisk(hour({ capeJkg: null, liftedIndex: null }))).toBe('low');
  });
});

describe('оценка часа одной модели', () => {
  const judge = (patch: Partial<ModelHour>) => evaluateModelHour('ecmwf', hour(patch), SURFACE_M, site);

  it('дождь, сильный ветер, порывы, ветер не в сектор — нелётно, с причиной', () => {
    expect(judge({ precipitationMm: 1 })).toMatchObject({ verdict: 'nofly', reasons: ['rain'] });
    expect(judge({ windSpeedMs: 8, gustMs: 9 })).toMatchObject({ verdict: 'nofly', reasons: ['wind_strong'] });
    expect(judge({ gustMs: 12 })).toMatchObject({ verdict: 'nofly', reasons: ['gusts'] });
    expect(judge({ windDirDeg: 180 })).toMatchObject({ verdict: 'nofly', reasons: ['wind_sector'] });
  });

  it('штиль с любого направления — сектор не мешает', () => {
    expect(judge({ windDirDeg: 180, windSpeedMs: 1 }).reasons).not.toContain('wind_sector');
  });

  it('ветер у предела и сильный ветер наверху — «на грани»', () => {
    expect(judge({ windSpeedMs: 6 })).toMatchObject({ verdict: 'marginal', reasons: ['wind_strong'] });
    const windyAloft = hour({ levels: hour().levels.map((l) => ({ ...l, windSpeedMs: 12 })) });
    expect(evaluateModelHour('ecmwf', windyAloft, SURFACE_M, site)).toMatchObject({ verdict: 'marginal', reasons: ['upper_wind'] });
  });

  it('потолок выше 1200 м над стартом и подъём от 1,5 м/с — XC-день', () => {
    const verdict = judge({});
    expect(verdict.ceilingM).not.toBeNull();
    expect((verdict.ceilingM ?? 0) - SURFACE_M).toBeGreaterThan(FORECAST.xcCeilingM);
    expect(verdict.thermalMs).toBeGreaterThan(FORECAST.xcThermalMs);
    expect(verdict.verdict).toBe('xc');
  });

  it('кучёвка ниже сухого потолка — потолок по базе облаков', () => {
    const verdict = judge({ dewPointC: 16 });
    expect(verdict.cloudBaseM).toBe(SURFACE_M + 4 * FORECAST.espyMPerC);
    expect(verdict.ceilingM).toBe(verdict.cloudBaseM);
    expect(verdict.verdict).toBe('flyable');
  });

  it('инверсия у земли — лётно, но только слёт', () => {
    const inversion = hour({ levels: [{ hPa: 700, heightM: 3000, temperatureC: 15, windSpeedMs: 2, windDirDeg: 0 }] });
    expect(evaluateModelHour('ecmwf', inversion, SURFACE_M, site)).toMatchObject({ verdict: 'flyable', reasons: ['low_ceiling'] });
  });
});

describe('evaluateForecast — согласие моделей', () => {
  const series = (model: ModelSeries['model'], patch: Partial<ModelHour>): ModelSeries => ({ model, surfaceM: SURFACE_M, hours: [hour(patch)] });

  it('главная — ECMWF, первой; все согласны — уверенность высокая', () => {
    const [h] = evaluateForecast([series('gfs', {}), series('ecmwf', {}), series('icon', {})], site);
    expect(h?.models.map((m) => m.model)).toEqual(['ecmwf', 'gfs', 'icon']);
    expect(h?.confidence).toBe('high');
  });

  it('две из трёх против главной — уверенность низкая; разброс потолка по моделям', () => {
    const [h] = evaluateForecast([series('ecmwf', {}), series('gfs', { precipitationMm: 2 }), series('icon', { precipitationMm: 2 })], site);
    expect(h?.verdict).toBe('xc');
    expect(h?.confidence).toBe('low');
    const [low, high] = h?.ceilingRangeM ?? [0, 0];
    expect(low).toBeLessThanOrEqual(high);
  });
});

describe('evaluateForecast на реальном прогнозе по Уш-Коныру', () => {
  const FIXTURES = new URL('../../../fixtures/forecast/', import.meta.url);
  const parse = (file: string, model: ModelSeries['model']): ModelSeries => {
    const series = parseOpenMeteo(JSON.parse(readFileSync(new URL(`ush-konyr.${file}.json`, FIXTURES), 'utf8')), model).series;
    if (!series) throw new Error(`${file}: series expected`);
    return series;
  };
  const ecmwf = withLevelsFrom(parse('ecmwf_ifs', 'ecmwf'), parse('ecmwf_ifs025', 'ecmwf'));
  const all = [ecmwf, parse('gfs_seamless', 'gfs'), parse('icon_global', 'icon')];
  const ush: ForecastSite = { elevationM: ecmwf.surfaceM, windSectors: ['N', 'NE', 'NW'], maxWindMs: null };
  const hours = evaluateForecast(all, ush);

  it('72 часа, у каждого три модели, ECMWF первой; потолок не ниже земли модели', () => {
    expect(hours).toHaveLength(72);
    for (const h of hours) {
      expect(h.models.map((m) => m.model)).toEqual(['ecmwf', 'gfs', 'icon']);
      for (const m of h.models) {
        // У моделей свои узлы сетки — свой геоид и своя «земля» (разница — метры).
        const surfaceM = all.find((s) => s.model === m.model)?.surfaceM ?? Number.NaN;
        if (m.ceilingM !== null) expect(m.ceilingM).toBeGreaterThanOrEqual(surfaceM);
      }
      if (h.ceilingRangeM) {
        expect(h.ceilingRangeM[0]).toBeLessThanOrEqual(h.ceilingRangeM[1]);
        const primary = h.models[0]?.ceilingM;
        if (primary !== null && primary !== undefined) {
          expect(primary).toBeGreaterThanOrEqual(h.ceilingRangeM[0]);
          expect(primary).toBeLessThanOrEqual(h.ceilingRangeM[1]);
        }
      }
    }
  });

  it('вердикт часа — вердикт ECMWF; профиль — земля модели и уровни над ней по возрастанию', () => {
    for (const h of hours) {
      expect(h.verdict).toBe(h.models[0]?.verdict);
      expect(h.surface.heightM).toBe(ecmwf.surfaceM);
      const heights = h.profile.map((p) => p.heightM);
      expect(heights).toEqual([...heights].sort((a, b) => a - b));
      for (const height of heights) expect(height).toBeGreaterThan(h.surface.heightM);
      expect(h.profile.every((p) => Number.isFinite(p.temperatureC))).toBe(true);
    }
  });

  it('ночью (02:00 по Алматы) термиков нет: GFS даёт поток тепла ≤ 0 — подъём 0', () => {
    const night = hours.find((h) => h.timeMs === Date.UTC(2026, 8, 29, 21));
    expect(night?.models.find((m) => m.model === 'gfs')?.thermalMs).toBe(0);
  });

  it('ветер по высотам — у модели с большим числом уровней в слое полёта (у ECMWF нет 800 гПа — берётся GFS)', () => {
    for (const h of hours) {
      expect(h.windModel).toBe('gfs');
      expect(h.wind.length).toBeGreaterThan(h.profile.length + 1);
      const heights = h.wind.map((p) => p.heightM);
      expect(heights).toEqual([...heights].sort((a, b) => a - b));
    }
  });

  it('детерминирован', () => {
    expect(evaluateForecast(all, ush)).toEqual(hours);
  });
});
