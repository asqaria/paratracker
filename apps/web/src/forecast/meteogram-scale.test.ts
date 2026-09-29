import { describe, expect, it } from 'vitest';

import { instabilityClass, lapseRateAt, meteogramRange, METEOGRAM, windAt } from './meteogram-scale';

const point = (heightM: number, temperatureC: number) => ({ heightM, temperatureC, speedMs: 0, dirDeg: 0 });

describe('lapseRateAt — темп остывания на высоте', () => {
  // Слой 2000–3000: 20 → 10 °C (1,0 на 100 м); 3000–5000: 10 → 0 °C (0,5 на 100 м).
  const profile = [point(2000, 20), point(3000, 10), point(5000, 0)];

  it('в середине слоя — темп этого слоя', () => {
    expect(lapseRateAt(profile, 2500)).toBeCloseTo(1, 9);
    expect(lapseRateAt(profile, 4000)).toBeCloseTo(0.5, 9);
  });

  it('между серединами слоёв — линейно, без ступеньки', () => {
    // Середины 2500 и 4000; 3250 — посередине: (1 + 0,5) / 2.
    expect(lapseRateAt(profile, 3250)).toBeCloseTo(0.75, 9);
  });

  it('ниже середины первого и выше середины последнего — темп крайнего слоя', () => {
    expect(lapseRateAt(profile, 2100)).toBeCloseTo(1, 9);
    expect(lapseRateAt(profile, 4900)).toBeCloseTo(0.5, 9);
  });

  it('инверсия — отрицательный темп; вне профиля — null', () => {
    expect(lapseRateAt([point(2000, 5), point(2500, 7)], 2250)).toBeCloseTo(-0.4, 9);
    expect(lapseRateAt(profile, 1900)).toBeNull();
    expect(lapseRateAt(profile, 5100)).toBeNull();
    expect(lapseRateAt([point(2000, 5)], 2000)).toBeNull();
  });
});

describe('instabilityClass', () => {
  it('пороги: инверсия, устойчиво, слабо, умеренно, хорошо, сильно', () => {
    expect([-0.2, 0.3, 0.55, 0.7, 0.85, 0.98].map(instabilityClass)).toEqual(['inversion', 'stable', 'weak', 'moderate', 'good', 'strong']);
  });
});

describe('meteogramRange', () => {
  it('потолок + 1,5 км, не меньше старт + 2,5 км, не выше 6 км', () => {
    expect(meteogramRange(1900, [2400, 3300, null])).toEqual({ bottomM: 1900, topM: 3300 + METEOGRAM.aboveCeilingM });
    expect(meteogramRange(1900, [null])).toEqual({ bottomM: 1900, topM: 1900 + METEOGRAM.minSpanM });
    expect(meteogramRange(1900, [5500]).topM).toBe(METEOGRAM.maxTopM);
  });
});

describe('windAt — ветер между уровнями модели', () => {
  const wind = (heightM: number, speedMs: number, dirDeg: number) => ({ heightM, temperatureC: 0, speedMs, dirDeg });

  it('на уровне — ветер уровня; посередине — среднее вектора', () => {
    const points = [wind(2000, 4, 90), wind(3000, 8, 90)];
    expect(windAt(points, 2000)).toEqual({ speedMs: 4, dirDeg: 90 });
    const mid = windAt(points, 2500);
    expect(mid?.speedMs).toBeCloseTo(6, 9);
    expect(mid?.dirDeg).toBeCloseTo(90, 9);
  });

  it('через север — 0°, а не 180°', () => {
    const mid = windAt([wind(2000, 5, 350), wind(3000, 5, 10)], 2500);
    expect(Math.min(mid?.dirDeg ?? 99, 360 - (mid?.dirDeg ?? 99))).toBeCloseTo(0, 6);
  });

  it('вне профиля — null', () => {
    expect(windAt([wind(2000, 4, 90), wind(3000, 8, 90)], 3500)).toBeNull();
    expect(windAt([wind(2000, 4, 90)], 2000)).toBeNull();
  });
});

