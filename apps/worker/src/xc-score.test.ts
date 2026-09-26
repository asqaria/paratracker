import { cleanAndDerive, flightRange, haversineDistance } from '@skyline/analysis';
import { parseIgc } from '@skyline/parsing';
import { describe, expect, it } from 'vitest';

import { NOW, readFixture } from './testing/tracks.js';
import { scoreXc, type XcColumns } from './xc-score.js';

/**
 * XC-скоринг (ТЗ §6.6). Счёт — igc-xc-score: геометрию проверяем на синтетике
 * с известными сторонами, а реальный трек фиксирует результат библиотеки
 * версии 1.8.0 — его изменение при обновлении зависимости — повод разобраться.
 */

const KM = 1000;
/** Дистанция библиотеки — по приближению FCC на сфере: 1 % от гаверсинуса с запасом. */
const DISTANCE_TOLERANCE = 0.01;
const LAT0 = 43.2;
const LON0 = 76.9;
const M_LAT = 111_320;
const M_LON = M_LAT * Math.cos((LAT0 * Math.PI) / 180);
const START = Date.UTC(2026, 6, 15, 10);
const SPEED_MS = 10;

/** Синтетический полёт по курсам: [курс, секунд] — 10 м/с, фикс раз в секунду. */
function track(legs: readonly [headingDeg: number, seconds: number][]): XcColumns {
  const east = [0];
  const north = [0];
  for (const [heading, seconds] of legs) {
    for (let s = 0; s < seconds; s++) {
      east.push((east.at(-1) ?? 0) + SPEED_MS * Math.sin((heading * Math.PI) / 180));
      north.push((north.at(-1) ?? 0) + SPEED_MS * Math.cos((heading * Math.PI) / 180));
    }
  }
  return {
    t: Float64Array.from(east, (_, i) => START + i * 1000),
    lat: Float64Array.from(north, (y) => LAT0 + y / M_LAT),
    lon: Float64Array.from(east, (x) => LON0 + x / M_LON),
    altitude: new Float64Array(east.length).fill(1500),
  };
}
const whole = (c: XcColumns) => ({ takeoff: 0, landing: c.t.length - 1 });

describe('scoreXc — геометрия на синтетике', () => {
  it('прямо на север 20 км — свободная дистанция 20 км, очки = км', () => {
    const c = track([[0, 2000]]);
    const xc = scoreXc(c, whole(c));
    expect(xc).toMatchObject({ rules: 'XContest', type: 'free_distance', multiplier: 1 });
    const straight = haversineDistance(c.lat[0] ?? 0, c.lon[0] ?? 0, c.lat.at(-1) ?? 0, c.lon.at(-1) ?? 0);
    expect(Math.abs((xc?.distanceM ?? 0) / straight - 1)).toBeLessThan(DISTANCE_TOLERANCE);
    expect(xc?.score).toBeCloseTo((xc?.distanceM ?? 0) / KM, 1);
    expect(xc?.route.length).toBeGreaterThanOrEqual(2);
    expect(xc?.closing).toBeNull();
  });

  it('равносторонний треугольник 3 × 10 км, замкнут — FAI-треугольник ×1.6 (XContest: closed FAI)', () => {
    const c = track([
      [0, 1000],
      [120, 1000],
      [240, 1000],
    ]);
    const xc = scoreXc(c, whole(c));
    expect(xc).toMatchObject({ type: 'fai_triangle', multiplier: 1.6, optimal: true });
    expect(Math.abs((xc?.distanceM ?? 0) / (30 * KM) - 1)).toBeLessThan(DISTANCE_TOLERANCE);
    expect(xc?.route).toHaveLength(3);
    expect(xc?.closing?.distanceM).toBeLessThan(100);
  });

  it('детерминированный: тот же вход — тот же результат', () => {
    const c = track([
      [10, 800],
      [80, 700],
    ]);
    expect(scoreXc(c, whole(c))).toEqual(scoreXc(c, whole(c)));
  });

  it('меньше пяти точек в полёте — не считается', () => {
    const c = track([[0, 3]]);
    expect(scoreXc(c, whole(c))).toBeNull();
  });
});

describe('scoreXc на реальном треке real-wind-thermals.igc', () => {
  it('закрытый свободный треугольник ~70 км — результат igc-xc-score 1.8.0', () => {
    const parsed = parseIgc(readFixture('real-wind-thermals.igc'), { now: NOW });
    if (!parsed.ok) throw new Error(`parse failed: ${parsed.code}`);
    const { points } = cleanAndDerive(parsed.track);
    const range = flightRange(points.t, points.groundSpeed);
    const xc = scoreXc({ t: points.t, lat: points.lat, lon: points.lon, altitude: points.altitude }, range);
    expect(xc).toMatchObject({ type: 'free_triangle', name: 'Closed Free Triangle', multiplier: 1.4, optimal: true });
    expect(xc?.distanceM).toBe(70_450);
    expect(xc?.score).toBe(96.91);
    // Вершины и замыкание — внутри полёта.
    for (const p of [...(xc?.route ?? []), xc?.closing?.in, xc?.closing?.out]) {
      expect(p?.timeMs).toBeGreaterThanOrEqual(points.t[range.takeoff] ?? 0);
      expect(p?.timeMs).toBeLessThanOrEqual(points.t[range.landing] ?? 0);
    }
  });
});
