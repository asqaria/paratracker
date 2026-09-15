import { describe, expect, it } from 'vitest';

import { dropLowQualityFixes } from './quality-filter.js';
import { seconds, track } from './testing/tracks.js';

const LIMITS = { maxAccuracyM: 50, minSatellites: 4 };

describe('dropLowQualityFixes', () => {
  it('fxa > 50 м и siu < 4 отброшены; ровно 50 м и 4 спутника остаются', () => {
    const input = track({
      t: seconds(0, 1, 2, 3, 4),
      lat: [0, 1, 2, 3, 4],
      fxa: [10, 51, 50, 10, 10],
      siu: [9, 9, 9, 3, 4],
    });

    const result = dropLowQualityFixes(input, LIMITS);

    expect(Array.from(result.points.lat)).toEqual([0, 2, 4]);
    expect(Array.from(result.points.t)).toEqual(seconds(0, 2, 4));
    expect(result).toMatchObject({ dropped: 2, skipped: false });
  });

  it('поля не записаны (NaN) — фикс остаётся', () => {
    const input = track({ t: seconds(0, 1), fxa: [Number.NaN, 12], siu: [7, Number.NaN] });
    expect(dropLowQualityFixes(input, LIMITS)).toMatchObject({ points: input, dropped: 0, skipped: false });
  });

  it('отброшено было бы всё — фильтр не применяется: прибор пишет в FXA мусор', () => {
    const input = track({ t: seconds(0, 1, 2), fxa: [999, 999, 999] });
    expect(dropLowQualityFixes(input, LIMITS)).toMatchObject({ points: input, dropped: 0, skipped: true });
  });
});
