import { GAIN } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { cleanAndDerive } from './clean-derive.js';
import { totalGain } from './total-gain.js';
import { expectation, parseFixture } from './testing/tracks.js';

/** Эталон — fixtures/expected.json (totalGainM): независимый гистерезис генератора. */
const EXACT = 1e-9;

describe('totalGain на фикстурах — точно до 1e-9', () => {
  it.each(['baseline.igc', 'gaps.igc', 'midnight.igc', 'south-west.igc', 'no-baro.igc', 'sparse-10s.igc'])(
    '%s',
    (name) => {
      const expected = expectation(name).totalGainM;
      if (expected === null) throw new Error(`No totalGainM for ${name} in fixtures/expected.json`);
      const { points, altitudeSource } = parseFixture(name);
      const alt = altitudeSource === 'baro' ? points.altBaro : points.altGnss;
      expect(Math.abs(totalGain(alt, 0, alt.length - 1) - expected)).toBeLessThanOrEqual(EXACT);
    },
  );
});

describe('totalGain после чистки — то, что видит пилот', () => {
  /**
   * Синтетический трек на стыке циклов прыгает вверх на ~288 м за секунду;
   * сглаживание Савицкого–Голея размазывает скачок по соседнему снижению
   * и съедает 3–4 % набора. На реальном треке скачков нет — допуск 5 %.
   */
  it('сглаженная высота даёт почти тот же набор, что сырая', () => {
    const { points } = cleanAndDerive(parseFixture('baseline.igc'));
    const expected = expectation('baseline.igc').totalGainM ?? 0;
    const actual = totalGain(points.altitude, 0, points.altitude.length - 1);
    expect(Math.abs(actual / expected - 1)).toBeLessThan(0.05);
  });
});

describe('totalGain — свойства', () => {
  const alt = (values: number[]) => Float64Array.from(values);

  it('шум меньше гистерезиса не набирается', () => {
    const noise = Array.from({ length: 200 }, (_, i) => 1000 + (i % 2) * (GAIN.hysteresisM - 1));
    expect(totalGain(alt(noise), 0, noise.length - 1)).toBe(0);
  });

  it('подъём, спуск и снова подъём — сумма подъёмов', () => {
    expect(totalGain(alt([1000, 1100, 1200, 1050, 900, 1000, 1300]), 0, 6)).toBe(600);
  });

  it('только в пределах [from, to]: подъём пешком до взлёта не считается', () => {
    // С индекса 2: 1200 → 1100 (опора вниз) → 1400 — набор 300, а 400 м подъёма до взлёта не в счёт.
    expect(totalGain(alt([800, 1000, 1200, 1100, 1400]), 2, 4)).toBe(300);
  });

  it('NaN пропускаются; пусто — 0', () => {
    expect(totalGain(alt([1000, Number.NaN, 1100]), 0, 2)).toBe(100);
    expect(totalGain(alt([]), 0, -1)).toBe(0);
  });
});
