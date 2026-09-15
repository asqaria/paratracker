import { describe, expect, it } from 'vitest';

import { savitzkyGolay, savitzkyGolayCoefficients } from './savitzky-golay.js';
import { seconds } from './testing/tracks.js';

const OPTIONS = { window: 9, order: 2, intervalS: 1 };
const PRECISION = 1e-9;
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

function expectClose(actual: ArrayLike<number>, wanted: ArrayLike<number>): void {
  expect(actual.length).toBe(wanted.length);
  for (let i = 0; i < wanted.length; i++) {
    const a = actual[i] ?? Number.NaN;
    const w = wanted[i] ?? Number.NaN;
    if (Number.isNaN(w)) expect(a, `[${i}]`).toBeNaN();
    else expect(Math.abs(a - w), `[${i}] ${a} vs ${w}`).toBeLessThanOrEqual(PRECISION);
  }
}

describe('savitzkyGolayCoefficients', () => {
  it('окно 9, полином 2, центр — классическая таблица (−21, 14, 39, 54, 59, 54, 39, 14, −21) / 231', () => {
    expectClose(
      savitzkyGolayCoefficients(9, 2, 4),
      [-21, 14, 39, 54, 59, 54, 39, 14, -21].map((c) => c / 231),
    );
  });

  it('коэффициенты любой позиции в сумме дают 1 — константа сохраняется', () => {
    for (const position of range(9)) {
      const sum = savitzkyGolayCoefficients(9, 2, position).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(PRECISION);
    }
  });
});

describe('savitzkyGolay', () => {
  it('квадратичную функцию сохраняет точно, включая края', () => {
    const quadratic = range(30).map((x) => 0.5 * x * x - 3 * x + 2350);
    expectClose(savitzkyGolay(Float64Array.from(quadratic), Float64Array.from(seconds(...range(30))), OPTIONS), quadratic);
  });

  it('гасит шум: пила ±1 вокруг постоянной высоты', () => {
    const noisy = Float64Array.from(range(40), (i) => 2400 + (i % 2 === 0 ? 1 : -1));
    const smoothed = savitzkyGolay(noisy, Float64Array.from(seconds(...range(40))), OPTIONS);
    // Отклик окна 9 / полинома 2 на частоте Найквиста: |Σ(−1)^j·c_j| = 41/231 ≈ 0.18.
    for (const value of smoothed.subarray(4, 36)) expect(Math.abs(value - 2400)).toBeCloseTo(41 / 231, 9);
  });

  it('NaN разрывает участок: NaN остаются, куски сглаживаются отдельно', () => {
    const a = range(12).map((x) => x * x);
    const b = range(12).map((x) => 1000 - 2 * x);
    const values = Float64Array.from([...a, Number.NaN, ...b]);
    expectClose(savitzkyGolay(values, Float64Array.from(seconds(...range(25))), OPTIONS), [...a, Number.NaN, ...b]);
  });

  it('разрыв сетки времени — куски по разные стороны не смешиваются', () => {
    const t = [...seconds(...range(12)), ...seconds(...range(12).map((x) => x + 500))];
    const values = [...range(12).map((x) => x * x), ...range(12).map((x) => -x * x + 50)];
    expectClose(savitzkyGolay(Float64Array.from(values), Float64Array.from(t), OPTIONS), values);
  });

  it('участок короче окна — полином той же или меньшей степени, без NaN', () => {
    expectClose(savitzkyGolay(Float64Array.of(5, 7, 9), Float64Array.from(seconds(0, 1, 2)), OPTIONS), [5, 7, 9]);
    expectClose(savitzkyGolay(Float64Array.of(42), Float64Array.of(0), OPTIONS), [42]);
  });

  it('исходный массив не меняется', () => {
    const values = Float64Array.from(range(20), (i) => i % 3);
    const copy = Float64Array.from(values);
    savitzkyGolay(values, Float64Array.from(seconds(...range(20))), OPTIONS);
    expect(values).toEqual(copy);
  });
});
