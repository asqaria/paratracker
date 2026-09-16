import { describe, expect, it } from 'vitest';

import { computeMotion } from './motion.js';
import { median, offsetDegrees, seconds } from './testing/tracks.js';

const OPTIONS = { intervalS: 1, minMovementM: 1, turnRate: true };
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('computeMotion', () => {
  it('равномерно на восток по экватору 10 м/с: скорость 10, курс 90°, разворота нет', () => {
    const { dLon } = offsetDegrees(0, 10, 0);
    const result = computeMotion(
      Float64Array.from(seconds(...range(10))),
      new Float64Array(10),
      Float64Array.from(range(10), (i) => i * dLon),
      OPTIONS,
    );

    for (const v of result.groundSpeed) expect(v).toBeCloseTo(10, 6);
    for (const h of result.heading) expect(h).toBeCloseTo(90, 6);
    expect(result.turnRate?.[0]).toBeNaN();
    for (const r of result.turnRate?.subarray(1) ?? []) expect(r).toBeCloseTo(0, 6);
  });

  it('круг радиусом 62 м за 20 с по часовой — разворот +18 °/с, скорость 2πR/T', () => {
    const lat0 = 43.128;
    const n = 60;
    const lat = new Float64Array(n);
    const lon = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i / 20) * 2 * Math.PI;
      const { dLat, dLon } = offsetDegrees(lat0, 62 * Math.sin(a), 62 * Math.cos(a));
      lat[i] = lat0 + dLat;
      lon[i] = 76.955 + dLon;
    }

    const result = computeMotion(Float64Array.from(seconds(...range(n))), lat, lon, OPTIONS);

    expect(median(result.turnRate ?? [])).toBeCloseTo(18, 1);
    // Хорда за 1 с короче дуги: 2R·sin(π/20).
    expect(median(result.groundSpeed)).toBeCloseTo(2 * 62 * Math.sin(Math.PI / 20), 2);
  });

  it('стоит на месте — курс и разворот не определены, скорость 0', () => {
    const result = computeMotion(Float64Array.from(seconds(0, 1, 2)), new Float64Array(3), new Float64Array(3), OPTIONS);
    expect(Array.from(result.groundSpeed)).toEqual([0, 0, 0]);
    expect(result.heading.every(Number.isNaN)).toBe(true);
    expect(result.turnRate?.every(Number.isNaN)).toBe(true);
  });

  it('через разрыв не считает: последняя точка сегмента берёт курс и скорость предыдущей', () => {
    const { dLat } = offsetDegrees(0, 0, 5);
    const t = Float64Array.from([...seconds(0, 1, 2), ...seconds(100, 101)]);
    const lat = Float64Array.from([0, dLat, 2 * dLat, 50, 50]);
    const result = computeMotion(t, lat, new Float64Array(5), OPTIONS);

    expect(result.groundSpeed[2]).toBeCloseTo(5, 6);
    expect(result.heading[2]).toBeCloseTo(0, 6);
    expect(result.groundSpeed[3]).toBe(0);
  });

  it('turnRate: false — не считается вовсе (analysis_level basic)', () => {
    const result = computeMotion(Float64Array.from(seconds(0, 1)), new Float64Array(2), new Float64Array(2), {
      ...OPTIONS,
      turnRate: false,
    });
    expect(result.turnRate).toBeNull();
  });
});
