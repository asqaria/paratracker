import { describe, expect, it } from 'vitest';

import { analysisLevelFor, medianFixIntervalS } from './sampling.js';
import { parseFixture, seconds } from './testing/tracks.js';

describe('medianFixIntervalS', () => {
  it('медиана шагов между фиксами, с', () => {
    expect(medianFixIntervalS(Float64Array.from(seconds(0, 1, 2, 12)))).toBe(1);
    expect(medianFixIntervalS(Float64Array.from(seconds(0, 1, 11, 21, 23)))).toBe(6);
  });

  it('меньше двух фиксов — NaN', () => {
    expect(medianFixIntervalS(Float64Array.of(0))).toBeNaN();
  });
});

describe('analysisLevelFor', () => {
  it('медианный шаг до 4 с включительно — full, дольше — basic (ТЗ §5.2)', () => {
    expect(analysisLevelFor(1)).toBe('full');
    expect(analysisLevelFor(4)).toBe('full');
    expect(analysisLevelFor(4.5)).toBe('basic');
    expect(analysisLevelFor(Number.NaN)).toBe('basic');
  });

  it('фикстуры: baseline.igc — full, sparse-10s.igc — basic', () => {
    expect(analysisLevelFor(medianFixIntervalS(parseFixture('baseline.igc').points.t))).toBe('full');
    expect(analysisLevelFor(medianFixIntervalS(parseFixture('sparse-10s.igc').points.t))).toBe('basic');
  });
});
