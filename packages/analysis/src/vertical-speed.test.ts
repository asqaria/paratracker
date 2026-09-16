import { describe, expect, it } from 'vitest';

import { seconds } from './testing/tracks.js';
import { verticalSpeed } from './vertical-speed.js';

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const grid = (n: number): Float64Array => Float64Array.from(seconds(...range(n)));

describe('verticalSpeed', () => {
  it.each([2, 4, 20])('линейная высота h = 2t: окно %i с даёт ровно 2 м/с, включая края', (windowS) => {
    const vz = verticalSpeed(grid(30), Float64Array.from(range(30), (i) => 2350 + 2 * i), { windowS, intervalS: 1 });
    expect(Array.from(vz)).toEqual(Array<number>(30).fill(2));
  });

  it('центральная разность ТЗ §6.1: vz[i] = (h[i + N/2] − h[i − N/2]) / N', () => {
    const vz = verticalSpeed(grid(30), Float64Array.from(range(30), (i) => i * i), { windowS: 4, intervalS: 1 });
    expect(vz[10]).toBe((12 * 12 - 8 * 8) / 4);
  });

  it('у края окно укорачивается по доступным отсчётам', () => {
    const vz = verticalSpeed(grid(30), Float64Array.from(range(30), (i) => i * i), { windowS: 4, intervalS: 1 });
    expect(vz[0]).toBe((2 * 2 - 0) / 2);
    expect(vz[1]).toBe((3 * 3 - 0) / 3);
  });

  it('через разрыв не считает: сегменты независимы', () => {
    const t = Float64Array.from([...seconds(0, 1, 2), ...seconds(100, 101, 102)]);
    const vz = verticalSpeed(t, Float64Array.of(0, 1, 2, 500, 500, 500), { windowS: 4, intervalS: 1 });
    expect(Array.from(vz)).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it('NaN высоты — NaN скорости; одиночная точка сегмента — NaN', () => {
    const t = Float64Array.from([...seconds(0, 1, 2), ...seconds(100)]);
    const vz = verticalSpeed(t, Float64Array.of(0, Number.NaN, 2, 7), { windowS: 2, intervalS: 1 });
    expect(Array.from(vz)).toEqual([Number.NaN, 1, Number.NaN, Number.NaN]);
  });
});
