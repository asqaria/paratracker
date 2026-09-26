import { MOTION } from '@skyline/core';

import { computeMotion } from '../motion.js';
import type { ThermalColumns } from '../thermals.js';

/** Синтетический полёт из участков для тестов детекции (§6.2–6.4). Из сборки исключён. */

export const LAT0 = 43.2;
export const LON0 = 76.9;
export const M_LAT = 111_320;
export const M_LON = M_LAT * Math.cos((LAT0 * Math.PI) / 180);
export const START = Date.UTC(2026, 6, 15, 10);
/** Воздушная скорость параплана по умолчанию, м/с. */
const CRUISE_MS = 10;

export interface Leg {
  seconds: number;
  /** Градусов поворота в секунду: 18 — круг за 20 с; 0 — прямо. */
  turnDegS: number;
  climbMs: number;
  /** Путевая скорость, м/с; по умолчанию 10 — параплан. Ходьба — 1.3. */
  speedMs?: number;
}

/** Трек из участков: вираж или прямая с заданным набором; окружность радиусом v/ω. */
export function flight(legs: Leg[]): ThermalColumns & { groundSpeed: Float64Array } {
  const east: number[] = [0];
  const north: number[] = [0];
  const up: number[] = [1500];
  const speed: number[] = [legs[0]?.speedMs ?? CRUISE_MS];
  let heading = 0;
  for (const leg of legs) {
    const v = leg.speedMs ?? CRUISE_MS;
    for (let s = 0; s < leg.seconds; s++) {
      heading += leg.turnDegS;
      east.push((east.at(-1) ?? 0) + v * Math.sin((heading * Math.PI) / 180));
      north.push((north.at(-1) ?? 0) + v * Math.cos((heading * Math.PI) / 180));
      up.push((up.at(-1) ?? 0) + leg.climbMs);
      speed.push(v);
    }
  }
  const n = east.length;
  const t = Float64Array.from({ length: n }, (_, s) => START + s * 1000);
  const lat = Float64Array.from(north, (y) => LAT0 + y / M_LAT);
  const lon = Float64Array.from(east, (x) => LON0 + x / M_LON);
  const altitude = Float64Array.from(up);
  const vSpeed = Float64Array.from(up, (_, s) => (up[Math.min(n - 1, s + 1)] ?? 0) - (up[Math.max(0, s - 1)] ?? 0)).map(
    (d, s) => d / (s === 0 || s === n - 1 ? 1 : 2),
  );
  const { heading: headings } = computeMotion(t, lat, lon, { intervalS: 1, minMovementM: MOTION.minMovementForHeadingM, turnRate: false });
  return { t, lat, lon, altitude, heading: headings, vSpeed, groundSpeed: Float64Array.from(speed) };
}
