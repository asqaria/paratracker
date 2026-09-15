import { TRACK_FLAGS } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { resample } from './resample.js';
import { expectation, fixtureStart, parseFixture, seconds, track } from './testing/tracks.js';

const OPTIONS = { intervalS: 1, maxGapS: 30 };
const flagged = (flags: Uint8Array, bit: number): number[] =>
  Array.from(flags).flatMap((f, i) => ((f & bit) !== 0 ? [i] : []));

describe('resample', () => {
  it('сетка 1 Гц, линейная интерполяция между фиксами', () => {
    const grid = resample(
      track({ t: seconds(0, 2, 4), lat: [0, 2, 3], lon: [10, 12, 16], altBaro: [100, 102, 106], altGnss: [150, 152, 156] }),
      OPTIONS,
    );

    expect(Array.from(grid.t)).toEqual(seconds(0, 1, 2, 3, 4));
    expect(Array.from(grid.lat)).toEqual([0, 1, 2, 2.5, 3]);
    expect(Array.from(grid.lon)).toEqual([10, 11, 12, 14, 16]);
    expect(Array.from(grid.altBaro)).toEqual([100, 101, 102, 104, 106]);
    expect(Array.from(grid.altGnss)).toEqual([150, 151, 152, 154, 156]);
    expect(grid.gapCount).toBe(0);
  });

  it('фиксы на дробной секунде — сетка по целым секундам внутри трека', () => {
    const grid = resample(track({ t: [500, 2500], lat: [0, 2] }), OPTIONS);
    expect(Array.from(grid.t)).toEqual(seconds(1, 2));
    expect(Array.from(grid.lat)).toEqual([0.5, 1.5]);
  });

  it('пропуск ровно 30 с интерполируется; больше 30 с — разрыв без точек внутри, края помечены', () => {
    const grid = resample(track({ t: seconds(0, 30, 61, 62), lat: [0, 30, 100, 101] }), OPTIONS);

    expect(grid.t.length).toBe(31 + 2);
    expect(grid.t[30]).toBe(30_000);
    expect(grid.t[31]).toBe(61_000);
    expect(flagged(grid.flags, TRACK_FLAGS.gap)).toEqual([30, 31]);
    expect(grid.gapCount).toBe(1);
  });

  it('высота — только по 3D-фиксам; точки, где участвовал 2D-фикс, помечены', () => {
    const grid = resample(
      track({ t: seconds(0, 2, 4), altBaro: [100, 999, 104], valid: [1, 0, 1] }),
      OPTIONS,
    );

    expect(Array.from(grid.altBaro)).toEqual([100, 101, 102, 103, 104]);
    expect(flagged(grid.flags, TRACK_FLAGS.fix2d)).toEqual([1, 2, 3]);
  });

  it('у части фиксов нет высоты — берётся по соседним; с краю — ближайшая', () => {
    const grid = resample(track({ t: seconds(0, 1, 2, 3), altGnss: [Number.NaN, 10, Number.NaN, 30] }), OPTIONS);
    expect(Array.from(grid.altGnss)).toEqual([10, 10, 20, 30]);
  });

  it('высоты нет вовсе — NaN, координаты интерполируются', () => {
    const grid = resample(track({ t: seconds(0, 2), lat: [0, 2] }), OPTIONS);
    expect(Array.from(grid.lat)).toEqual([0, 1, 2]);
    expect(grid.altBaro.every(Number.isNaN)).toBe(true);
  });

  it('через антимеридиан долгота идёт коротким путём', () => {
    const grid = resample(track({ t: seconds(0, 2), lon: [179.5, -179.5] }), OPTIONS);
    expect(Math.abs(grid.lon[1] ?? 0)).toBeCloseTo(180, 9);
  });

  it('gaps.igc: края разрывов помечены, внутри разрывов точек нет', () => {
    const grid = resample(parseFixture('gaps.igc').points, OPTIONS);
    const steps = Array.from(grid.t.subarray(1), (t, i) => (t - (grid.t[i] ?? 0)) / 1000);
    const edges = flagged(grid.flags, TRACK_FLAGS.gap);

    expect(grid.t[0]).toBe(fixtureStart('gaps.igc'));
    expect(grid.t.length).toBe(expectation('gaps.igc').pointCount);
    expect(grid.gapCount).toBe(2);
    expect(edges).toEqual([199, 200, 499, 500]);
    // Разрывы 90 с и 12 мин поверх шага 1 с; остальные шаги ровно 1 с.
    expect(steps.filter((s) => s !== 1)).toEqual([91, 721]);
    expect(steps[199]).toBe(91);
    expect(steps[499]).toBe(721);
  });
});
