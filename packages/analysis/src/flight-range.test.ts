import { describe, expect, it } from 'vitest';

import { flightRange, visibleRange } from './flight-range.js';
import { parseFixture } from './testing/tracks.js';
import { cleanAndDerive } from './clean-derive.js';

/** Шаг 1 с: t в мс по номеру точки. */
const times = (n: number): Float64Array => Float64Array.from({ length: n }, (_, i) => i * 1000);

/**
 * Путевая скорость синтетического трека по участкам: [секунд, м/с]. Ходьба в гору
 * — 1.3 м/с (замер на реальном подъёме пешком), полёт — 10 м/с, разбег — 4.5 м/с.
 */
function speeds(...parts: Array<[seconds: number, speedMs: number]>): Float64Array {
  return Float64Array.from(parts.flatMap(([seconds, speed]) => Array.from({ length: seconds }, () => speed)));
}

describe('flightRange — взлёт и посадка по скорости', () => {
  it('подъём пешком полтора часа — не полёт: взлёт после него', () => {
    const speed = speeds([5400, 1.3], [3, 4.5], [600, 10], [120, 0]);
    const range = flightRange(times(speed.length), speed);
    expect(range.takeoff).toBeGreaterThanOrEqual(5400);
    expect(range.takeoff).toBeLessThanOrEqual(5403);
  });

  it('короткий разбег не взлёт — взлёт, когда скорость держится', () => {
    // Два разбега по 5 с с остановкой, потом настоящий взлёт.
    const speed = speeds([60, 0], [5, 5], [20, 0], [5, 5], [20, 0], [600, 10]);
    expect(flightRange(times(speed.length), speed).takeoff).toBeGreaterThanOrEqual(110);
  });

  it('запись началась в воздухе — взлёт на первой точке', () => {
    const speed = speeds([600, 10], [60, 0]);
    expect(flightRange(times(speed.length), speed).takeoff).toBe(0);
  });

  it('после посадки пилот 30 минут идёт к дороге — это не полёт', () => {
    const speed = speeds([60, 0], [600, 10], [1800, 1.3]);
    const range = flightRange(times(speed.length), speed);
    expect(range.landing).toBeGreaterThanOrEqual(659);
    expect(range.landing).toBeLessThanOrEqual(661);
  });

  it('запись оборвалась в воздухе — посадка на последней точке', () => {
    const speed = speeds([60, 0], [600, 10]);
    expect(flightRange(times(speed.length), speed).landing).toBe(speed.length - 1);
  });

  it('полёта нет вовсе (запись на земле) — весь трек земля', () => {
    const speed = speeds([200, 1]);
    const range = flightRange(times(speed.length), speed);
    expect(range.takeoff).toBeGreaterThanOrEqual(range.landing);
  });

  it('пустой трек — takeoff и landing −1: точек нет', () => {
    expect(flightRange(new Float64Array(), new Float64Array())).toEqual({ takeoff: -1, landing: -1 });
  });

  it('baseline.igc — запись от первой до последней точки в воздухе', () => {
    const p = cleanAndDerive(parseFixture('baseline.igc')).points;
    expect(flightRange(p.t, p.groundSpeed)).toEqual({ takeoff: 0, landing: p.t.length - 1 });
  });
});

describe('visibleRange — что видят посторонние (задача 3.7)', () => {
  const t = Float64Array.from({ length: 100 }, (_, i) => i * 1000);

  it('от взлёта до посадки плюс 5 с до и после', () => {
    expect(visibleRange(t, { takeoff: 30, landing: 70 })).toEqual({ takeoff: 25, landing: 75 });
  });

  it('у краёв записи — не дальше первой и последней точки', () => {
    expect(visibleRange(t, { takeoff: 2, landing: 98 })).toEqual({ takeoff: 0, landing: 99 });
  });

  it('полёта нет — показывать нечего', () => {
    expect(visibleRange(t, { takeoff: 99, landing: 99 })).toBeNull();
    expect(visibleRange(new Float64Array(), { takeoff: -1, landing: -1 })).toBeNull();
  });
});
