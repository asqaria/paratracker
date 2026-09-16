import { TIME } from '@skyline/core';

import { haversineDistance, initialBearing, normalizeSignedDegrees } from './geo.js';
import { breakOffGrid, forEachSegment } from './grid.js';

export interface MotionOptions {
  intervalS: number;
  /** Смещение за шаг меньше — курс не определён. */
  minMovementM: number;
  /** false — скорость разворота не считается (analysis_level 'basic'). */
  turnRate: boolean;
}

export interface Motion {
  /** Путевая скорость, м/с. */
  groundSpeed: Float64Array;
  /** Курс от точки к следующей, [0, 360); NaN — стоит на месте. */
  heading: Float64Array;
  /** Изменение курса, °/с; плюс — по часовой. */
  turnRate: Float64Array | null;
}

/**
 * ТЗ §5.2 шаг 4 и §6.2: скорость и курс — от точки i к i+1; скорость разворота —
 * нормализованная разность курсов heading[i] − heading[i−1] за секунду.
 * Внутри сегментов сетки; последняя точка сегмента берёт значения предыдущей.
 */
export function computeMotion(t: Float64Array, lat: Float64Array, lon: Float64Array, options: MotionOptions): Motion {
  const n = t.length;
  const groundSpeed = new Float64Array(n).fill(Number.NaN);
  const heading = new Float64Array(n).fill(Number.NaN);
  const turnRate = options.turnRate ? new Float64Array(n).fill(Number.NaN) : null;

  forEachSegment(t, breakOffGrid(options.intervalS), (start, end) => {
    if (end === start) return;

    for (let i = start; i < end; i++) {
      const lat1 = lat[i] ?? Number.NaN;
      const lon1 = lon[i] ?? Number.NaN;
      const lat2 = lat[i + 1] ?? Number.NaN;
      const lon2 = lon[i + 1] ?? Number.NaN;
      const distance = haversineDistance(lat1, lon1, lat2, lon2);
      const dt = ((t[i + 1] ?? 0) - (t[i] ?? 0)) / TIME.msPerSecond;
      groundSpeed[i] = distance / dt;
      heading[i] = distance < options.minMovementM ? Number.NaN : initialBearing(lat1, lon1, lat2, lon2);
    }
    groundSpeed[end] = groundSpeed[end - 1] ?? Number.NaN;
    heading[end] = heading[end - 1] ?? Number.NaN;

    if (!turnRate) return;
    for (let i = start + 1; i < end; i++) {
      const dt = ((t[i] ?? 0) - (t[i - 1] ?? 0)) / TIME.msPerSecond;
      turnRate[i] = normalizeSignedDegrees((heading[i] ?? Number.NaN) - (heading[i - 1] ?? Number.NaN)) / dt;
    }
    turnRate[end] = end - 1 > start ? (turnRate[end - 1] ?? Number.NaN) : Number.NaN;
  });

  return { groundSpeed, heading, turnRate };
}
