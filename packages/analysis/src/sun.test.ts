import { describe, expect, it } from 'vitest';

import { sunPosition } from './sun.js';

/**
 * Положение солнца (задача П.4). Эталон — PyEphem 4.2 (геометрическое
 * положение, без рефракции) для Уш-Коныра, 43.127° с.ш. 76.465° в.д.
 * Алгоритм NOAA точен до сотых градуса; допуск — 0,05°.
 */

const USH = { lat: 43.127, lon: 76.465 };
const TOLERANCE_DEG = 0.05;

const cases = [
  { name: '30.09, полдень по Алматы', t: Date.UTC(2026, 8, 30, 7), az: 185.483, el: 43.898 },
  { name: '30.09, 8 утра — солнце на востоке', t: Date.UTC(2026, 8, 30, 3), az: 116.685, el: 21.958 },
  { name: 'летнее солнцестояние, 11:00', t: Date.UTC(2026, 5, 21, 6), az: 145.161, el: 67.177 },
  { name: 'зимнее солнцестояние, 11:00', t: Date.UTC(2026, 11, 21, 6), az: 167.084, el: 22.364 },
  { name: '30.09, 17:00 — низко на западе', t: Date.UTC(2026, 8, 30, 12), az: 260.289, el: 6.007 },
];

describe('sunPosition', () => {
  for (const c of cases) {
    it(c.name, () => {
      const sun = sunPosition(USH.lat, USH.lon, c.t);
      expect(Math.abs(sun.azimuthDeg - c.az)).toBeLessThan(TOLERANCE_DEG);
      expect(Math.abs(sun.elevationDeg - c.el)).toBeLessThan(TOLERANCE_DEG);
    });
  }

  it('ночью солнце под горизонтом', () => {
    expect(sunPosition(USH.lat, USH.lon, Date.UTC(2026, 8, 30, 19)).elevationDeg).toBeLessThan(0);
  });
});
