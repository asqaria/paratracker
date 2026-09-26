import { GEO, SIMPLIFY } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { simplifyTrack } from './simplify.js';
import { expectation, parseFixture } from './testing/tracks.js';

/** Эталон — fixtures/expected.json (simplified): независимый Дуглас–Пекер генератора. */

const METRES_PER_DEGREE = (GEO.meanEarthRadiusM * Math.PI) / 180;

/** Отклонение точки от отрезка в той же проекции, что и у алгоритма, м. */
function deviationM(lat: Float64Array, lon: Float64Array, a: number, b: number, i: number): number {
  const cosLat0 = Math.cos(((lat[0] ?? 0) * Math.PI) / 180);
  const x = (k: number) => (lon[k] ?? 0) * cosLat0 * METRES_PER_DEGREE;
  const y = (k: number) => (lat[k] ?? 0) * METRES_PER_DEGREE;
  const dx = x(b) - x(a);
  const dy = y(b) - y(a);
  const lengthSq = dx * dx + dy * dy;
  const u = lengthSq > 0 ? Math.max(0, Math.min(1, ((x(i) - x(a)) * dx + (y(i) - y(a)) * dy) / lengthSq)) : 0;
  return Math.hypot(x(i) - x(a) - u * dx, y(i) - y(a) - u * dy);
}

describe('simplifyTrack на фикстурах — те же точки, что у генератора', () => {
  it.each(['baseline.igc', 'gaps.igc', 'midnight.igc', 'south-west.igc', 'sparse-10s.igc', 'negative-alt.igc'])(
    '%s',
    (name) => {
      const expected = expectation(name).simplified;
      if (!expected) throw new Error(`No simplified for ${name} in fixtures/expected.json`);
      const { points } = parseFixture(name);
      const result = simplifyTrack(points.lat, points.lon);
      expect(result.toleranceM).toBe(expected.toleranceM);
      expect(Array.from(result.indices)).toEqual(expected.indices);
    },
  );
});

describe('simplifyTrack — свойства', () => {
  it('выброшенная точка отстоит от линии не дальше допуска; концы на месте', () => {
    const { points } = parseFixture('baseline.igc');
    const { indices, toleranceM } = simplifyTrack(points.lat, points.lon);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(points.lat.length - 1);
    for (let k = 1; k < indices.length; k++) {
      const a = indices[k - 1] ?? 0;
      const b = indices[k] ?? 0;
      for (let i = a + 1; i < b; i++) {
        expect(deviationM(points.lat, points.lon, a, b, i)).toBeLessThanOrEqual(toleranceM);
      }
    }
  });

  it('длинный трек не превышает потолок: допуск удваивается', () => {
    // Зигзаг с амплитудой 100 м: при 15 м нужна каждая точка.
    const n = SIMPLIFY.maxPoints * 3;
    const lat = Float64Array.from({ length: n }, (_, i) => 43 + (i % 2) * (100 / METRES_PER_DEGREE));
    const lon = Float64Array.from({ length: n }, (_, i) => 77 + (i * 10) / METRES_PER_DEGREE);
    const { indices, toleranceM } = simplifyTrack(lat, lon);
    expect(indices.length).toBeLessThanOrEqual(SIMPLIFY.maxPoints);
    expect(toleranceM).toBeGreaterThan(SIMPLIFY.toleranceM);
  });

  it('прямая сводится к двум точкам, одна точка — к одной, пусто — к пустому', () => {
    const line = Float64Array.from({ length: 50 }, (_, i) => 43 + i * 1e-4);
    const flat = new Float64Array(50).fill(77);
    expect(Array.from(simplifyTrack(line, flat).indices)).toEqual([0, 49]);
    expect(Array.from(simplifyTrack(Float64Array.of(43), Float64Array.of(77)).indices)).toEqual([0]);
    expect(Array.from(simplifyTrack(new Float64Array(0), new Float64Array(0)).indices)).toEqual([]);
  });
});
