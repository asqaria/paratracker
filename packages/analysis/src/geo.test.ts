import { GEO } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { haversineDistance, initialBearing, normalizeHeading, normalizeSignedDegrees } from './geo.js';

describe('haversineDistance', () => {
  it('градус меридиана = πR/180', () => {
    expect(haversineDistance(43, 77, 44, 77)).toBeCloseTo((Math.PI * GEO.meanEarthRadiusM) / 180, 6);
  });

  it('одна и та же точка — 0', () => {
    expect(haversineDistance(43.128, 76.955, 43.128, 76.955)).toBe(0);
  });

  it('через антимеридиан — короткий путь', () => {
    expect(haversineDistance(0, 179.9, 0, -179.9)).toBeCloseTo((0.2 * Math.PI * GEO.meanEarthRadiusM) / 180, 3);
  });
});

describe('initialBearing', () => {
  it.each([
    ['на север', 0, 0, 1, 0, 0],
    ['на восток', 0, 0, 0, 1, 90],
    ['на юг', 0, 0, -1, 0, 180],
    ['на запад', 0, 0, 0, -1, 270],
    ['на восток через антимеридиан', 0, 179.9, 0, -179.9, 90],
  ])('%s', (_, lat1, lon1, lat2, lon2, expected) => {
    expect(initialBearing(lat1, lon1, lat2, lon2)).toBeCloseTo(expected, 9);
  });
});

describe('нормализация углов', () => {
  it('курс — в [0, 360)', () => {
    expect([-10, 0, 360, 725, -360].map(normalizeHeading)).toEqual([350, 0, 0, 5, 0]);
  });

  it('разность курсов — в (−180, 180]', () => {
    expect([190, -190, 180, -180, 540, 0].map(normalizeSignedDegrees)).toEqual([-170, 170, 180, 180, 180, 0]);
  });
});
