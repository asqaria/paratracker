import { describe, expect, it } from 'vitest';

import { pointAt, trackLength, type TrackColumns } from './track.js';

const columns = (): TrackColumns => ({
  t: Float64Array.of(1000, 2000),
  lat: Float64Array.of(43.1, 43.2),
  lon: Float64Array.of(76.9, 77),
  altBaro: Float64Array.of(2350, Number.NaN),
  altGnss: Float64Array.of(Number.NaN, 2400),
  valid: Uint8Array.of(1, 0),
  fxa: Float64Array.of(12, Number.NaN),
  siu: Float64Array.of(Number.NaN, 9),
});

describe('pointAt', () => {
  it('NaN в колонке высоты — null в точке', () => {
    expect(pointAt(columns(), 0)).toEqual({
      t: 1000,
      lat: 43.1,
      lon: 76.9,
      altBaro: 2350,
      altGnss: null,
      valid: true,
      fxa: 12,
    });
  });

  it('fxa и siu не попадают в точку, если их нет', () => {
    const point = pointAt(columns(), 1);
    expect(point).toEqual({ t: 2000, lat: 43.2, lon: 77, altBaro: null, altGnss: 2400, valid: false, siu: 9 });
    expect('fxa' in point).toBe(false);
  });

  it('индекс вне трека — RangeError', () => {
    expect(trackLength(columns())).toBe(2);
    expect(() => pointAt(columns(), 2)).toThrow(RangeError);
    expect(() => pointAt(columns(), -1)).toThrow(RangeError);
  });
});
