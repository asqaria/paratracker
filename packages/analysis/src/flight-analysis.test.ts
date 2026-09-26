import { CIRCLE, GLIDE, WIND } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { detectCircles } from './circles.js';
import { cleanAndDerive } from './clean-derive.js';
import { analyseFlight } from './flight-analysis.js';
import { flightRange } from './flight-range.js';
import { detectGlides } from './glides.js';
import { parseFixture } from './testing/tracks.js';
import { detectThermals } from './thermals.js';
import { estimateWind } from './wind.js';

/**
 * Анализ полёта целиком: оркестровка детекторов §6.2–6.5 и агрегаты flights.
 * Цифры детекторов проверены в их тестах; здесь — что они собраны правильно.
 */

describe('analyseFlight на реальном треке', () => {
  const derived = cleanAndDerive(parseFixture('real-wind-thermals.igc'));
  const analysis = analyseFlight(derived, 'paraglider');
  const p = derived.points;
  const columns = { t: p.t, lat: p.lat, lon: p.lon, altitude: p.altitude, heading: p.heading, vSpeed: p.vSpeedDamped };
  const circles = detectCircles(columns, CIRCLE.paraglider);
  const thermals = detectThermals(columns, circles, CIRCLE.paraglider);
  const glides = detectGlides(columns, thermals, flightRange(p.t, p.groundSpeed));
  const wind = estimateWind(columns, circles, thermals, WIND.paraglider);

  it('термики и глайды — те же, что у детекторов', () => {
    expect(analysis).not.toBeNull();
    expect(analysis?.thermals.map((t) => [t.startIndex, t.endIndex])).toEqual(thermals.map((t) => [t.startIndex, t.endIndex]));
    expect(analysis?.glides).toEqual(glides);
  });

  it('точки входа и выхода термика — координаты его крайних точек', () => {
    for (const thermal of analysis?.thermals ?? []) {
      expect(thermal.entryLat).toBe(p.lat[thermal.startIndex]);
      expect(thermal.entryLon).toBe(p.lon[thermal.startIndex]);
      expect(thermal.exitLat).toBe(p.lat[thermal.endIndex]);
      expect(thermal.exitLon).toBe(p.lon[thermal.endIndex]);
    }
  });

  it('снос термика — уже «откуда дует» (метод A из оценки ветра)', () => {
    analysis?.thermals.forEach((thermal, k) => {
      expect(thermal.drift).toEqual(wind.thermals[k]?.drift ?? null);
      if (thermal.drift && thermal.driftEastMs !== null) {
        // Снос на запад — ветер с востока: направления разнятся на 180°.
        const toDeg = (Math.atan2(thermal.driftEastMs, thermal.driftNorthMs ?? 0) * 180) / Math.PI;
        expect(Math.abs(((thermal.drift.dirDeg - toDeg + 720) % 360) - 180)).toBeLessThan(1e-9);
      }
    });
  });

  it('агрегаты: средний набор — по времени, среднее качество — по пути, без dynamic', () => {
    const gain = thermals.reduce((sum, t) => sum + t.gainM, 0);
    const time = thermals.reduce((sum, t) => sum + t.durationS, 0);
    expect(analysis?.avgClimbMs).toBeCloseTo(gain / time, 9);
    const real = glides.filter((g) => g.kind === 'glide');
    const ratio = real.reduce((sum, g) => sum + g.distanceM, 0) / real.reduce((sum, g) => sum + g.altLossM, 0);
    expect(analysis?.avgGlideRatio).toBeCloseTo(Math.min(GLIDE.maxGlideRatio, ratio), 9);
  });

  it('ветер полёта и профиль — из оценки ветра', () => {
    expect(analysis?.wind).toEqual(wind.flight);
    expect(analysis?.windProfile).toEqual(wind.profile);
  });
});

describe('analyseFlight — когда анализа нет', () => {
  it('редкий трек (шаг 10 с, analysis_level basic) — не анализируется: виражи срезаны хордами', () => {
    const derived = cleanAndDerive(parseFixture('sparse-10s.igc'));
    expect(derived.analysisLevel).toBe('basic');
    expect(analyseFlight(derived, 'paraglider')).toBeNull();
  });

  it('полёт без термиков — агрегаты термиков null, глайд есть', () => {
    // baseline.igc, обрезанный до первого перехода генератора (точки 240…469), — кругов нет.
    const derived = cleanAndDerive(parseFixture('baseline.igc'));
    const slice = <T extends Float64Array | Uint8Array>(column: T): T => column.slice(240, 470) as T;
    const p = derived.points;
    const glideOnly = {
      ...derived,
      points: {
        ...p,
        t: slice(p.t),
        lat: slice(p.lat),
        lon: slice(p.lon),
        altBaro: slice(p.altBaro),
        altGnss: slice(p.altGnss),
        altitude: slice(p.altitude),
        vSpeedInstant: slice(p.vSpeedInstant),
        vSpeedDamped: slice(p.vSpeedDamped),
        vSpeedIntegral: slice(p.vSpeedIntegral),
        groundSpeed: slice(p.groundSpeed),
        heading: slice(p.heading),
        turnRate: p.turnRate ? slice(p.turnRate) : null,
        flags: slice(p.flags),
      },
    };
    const analysis = analyseFlight(glideOnly, 'paraglider');
    expect(analysis?.thermals).toEqual([]);
    expect(analysis?.avgClimbMs).toBeNull();
    expect(analysis?.wind).toBeNull();
    expect(analysis?.windProfile).toEqual([]);
    expect(analysis?.glides).toHaveLength(1);
    expect(analysis?.avgGlideRatio).toBeGreaterThan(5);
  });
});
