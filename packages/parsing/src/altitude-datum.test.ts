import type { TrackColumns } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { applyGnssDatum, igcAltitudeDatum } from './altitude-datum.js';
import { geoidHeightM } from './geoid.js';

const columns = (altGnss: number[]): TrackColumns => {
  const n = altGnss.length;
  return {
    t: Float64Array.from({ length: n }, (_, i) => i * 1000),
    lat: new Float64Array(n).fill(43.1274),
    lon: new Float64Array(n).fill(76.4648),
    altBaro: new Float64Array(n).fill(Number.NaN),
    altGnss: Float64Array.from(altGnss),
    valid: new Uint8Array(n).fill(1),
    fxa: new Float64Array(n).fill(Number.NaN),
    siu: new Float64Array(n).fill(Number.NaN),
  };
};
const N = geoidHeightM(43.1274, 76.4648);

describe('igcAltitudeDatum — код HF ALG (IGC FR Spec, прил. A3; CIVL 7H §3.2.3)', () => {
  it.each([
    ['ELL', 'ellipsoid'],
    ['GEO', 'geoid'],
    ['MSL', 'geoid'],
    ['NIL', 'none'],
    ['NKN', 'assumed-geoid'],
  ] as const)('%s → %s', (code, datum) => {
    expect(igcAltitudeDatum(code)).toEqual({ datum, recognized: true });
  });

  it('заголовка нет — геоид по умолчанию (CIVL 7H §3.2.1), это не ошибка', () => {
    expect(igcAltitudeDatum(null)).toEqual({ datum: 'assumed-geoid', recognized: true });
  });

  it('регистр и пробелы не важны', () => {
    expect(igcAltitudeDatum(' geo ')).toEqual({ datum: 'geoid', recognized: true });
  });

  it('незнакомый код — геоид по умолчанию, но с пометкой', () => {
    expect(igcAltitudeDatum('WGS')).toEqual({ datum: 'assumed-geoid', recognized: false });
  });
});

describe('applyGnssDatum', () => {
  it('геоид: h = H + N в каждой точке', () => {
    const points = columns([1935, 1940]);
    expect(applyGnssDatum(points, 'geoid')).toBe('geoid');
    expect(points.altGnss[0]).toBeCloseTo(1935 + N, 9);
    expect(points.altGnss[1]).toBeCloseTo(1940 + N, 9);
  });

  it('assumed-geoid пересчитывается так же', () => {
    const points = columns([1935]);
    applyGnssDatum(points, 'assumed-geoid');
    expect(points.altGnss[0]).toBeCloseTo(1935 + N, 9);
  });

  it('эллипсоид — без изменений', () => {
    const points = columns([1935]);
    expect(applyGnssDatum(points, 'ellipsoid')).toBe('ellipsoid');
    expect(points.altGnss[0]).toBe(1935);
  });

  it('NaN остаётся NaN — пропуск высоты не превращается в N', () => {
    const points = columns([Number.NaN, 1935]);
    applyGnssDatum(points, 'geoid');
    expect(points.altGnss[0]).toBeNaN();
  });

  it('none — высоты нет, даже если в B-записях были числа', () => {
    const points = columns([1935, 1940]);
    expect(applyGnssDatum(points, 'none')).toBe('none');
    expect(points.altGnss.every(Number.isNaN)).toBe(true);
  });

  it('GNSS-высоты нет ни в одной точке — в meta none, а не объявленный датум', () => {
    expect(applyGnssDatum(columns([Number.NaN, Number.NaN]), 'geoid')).toBe('none');
  });
});
