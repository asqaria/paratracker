import { TIME } from '@skyline/core';

import { breakOffGrid, forEachSegment } from './grid.js';

export interface VerticalSpeedOptions {
  /** Окно N центральной разности, с. */
  windowS: number;
  intervalS: number;
}

/**
 * ТЗ §6.1: vz[i] = (h[i + N/2] − h[i − N/2]) / N, м/с — на равномерной сетке.
 * Через разрыв не считаем; у краёв сегмента окно укорачивается по доступным отсчётам,
 * делитель — фактическое время между ними. Одиночная точка или NaN высоты — NaN.
 */
export function verticalSpeed(t: Float64Array, altitude: Float64Array, options: VerticalSpeedOptions): Float64Array {
  const out = new Float64Array(t.length).fill(Number.NaN);
  const half = Math.round(options.windowS / 2 / options.intervalS);

  forEachSegment(t, breakOffGrid(options.intervalS), (start, end) => {
    if (end === start) return;
    for (let i = start; i <= end; i++) {
      const lo = Math.max(start, i - half);
      const hi = Math.min(end, i + half);
      const dt = ((t[hi] ?? 0) - (t[lo] ?? 0)) / TIME.msPerSecond;
      out[i] = ((altitude[hi] ?? Number.NaN) - (altitude[lo] ?? Number.NaN)) / dt;
    }
  });

  return out;
}
