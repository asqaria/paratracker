import { describe, expect, it } from 'vitest';

import { aglProfile } from './agl';

describe('aglProfile', () => {
  it('высота минус рельеф там, где рельеф есть; остальное — NaN', () => {
    const alt = Float64Array.of(1950, 2100, 2500, 800);
    const agl = aglProfile(alt, new Map([[1, 1900], [2, 1600]]));
    expect(Array.from(agl)).toEqual([Number.NaN, 200, 900, Number.NaN]);
  });

  it('рельеф не пришёл (NaN) — точка пустая, а не отрицательная', () => {
    expect(Number.isNaN(aglProfile(Float64Array.of(2000), new Map([[0, Number.NaN]]))[0] ?? 0)).toBe(true);
  });
});
