import type { XcScoreDto } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { xcRoute } from './xc-route';

const point = (lat: number, lon: number, timeMs: number) => ({ lat, lon, timeMs });
const base: Omit<XcScoreDto, 'type' | 'route' | 'closing'> = {
  rules: 'XContest',
  name: 'x',
  distanceM: 30_000,
  score: 42,
  multiplier: 1.4,
  optimal: true,
};

describe('xcRoute', () => {
  it('треугольник — замкнутое кольцо, номера у трёх вершин', () => {
    const route = xcRoute({
      ...base,
      type: 'fai_triangle',
      route: [point(43, 76, 1), point(43.1, 76.1, 2), point(43, 76.2, 3)],
      closing: null,
    });
    expect(route?.closed).toBe(true);
    expect(route?.path).toEqual([
      [76, 43],
      [76.1, 43.1],
      [76.2, 43],
      [76, 43],
    ]);
    expect(route?.markers.map((m) => m.label)).toEqual(['1', '2', '3']);
  });

  it('свободная дистанция — ломаная; номера только у ППМ, старт и финиш — концы линии', () => {
    const route = xcRoute({
      ...base,
      type: 'free_distance',
      route: [point(43, 76, 1), point(43.1, 76.1, 2), point(43.2, 76.1, 3), point(43.3, 76.3, 4), point(43.4, 76.5, 5)],
      closing: null,
    });
    expect(route?.closed).toBe(false);
    expect(route?.path).toHaveLength(5);
    expect(route?.markers.map((m) => m.timeMs)).toEqual([2, 3, 4]);
  });

  it('маршрут из одной точки — рисовать нечего', () => {
    expect(xcRoute({ ...base, type: 'free_distance', route: [point(43, 76, 1)], closing: null })).toBeNull();
  });
});
