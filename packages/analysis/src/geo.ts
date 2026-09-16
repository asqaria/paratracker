import { GEO } from '@skyline/core';

const RADIANS_PER_DEGREE = Math.PI / 180;
const FULL_TURN_DEG = 360;
const HALF_TURN_DEG = 180;

/** Расстояние по большому кругу, м (гаверсинус на сфере GEO.meanEarthRadiusM). */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = lat1 * RADIANS_PER_DEGREE;
  const phi2 = lat2 * RADIANS_PER_DEGREE;
  const dPhi = (lat2 - lat1) * RADIANS_PER_DEGREE;
  const dLambda = (lon2 - lon1) * RADIANS_PER_DEGREE;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * GEO.meanEarthRadiusM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Начальный азимут от первой точки ко второй, градусы [0, 360); 0 — север, 90 — восток. */
export function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = lat1 * RADIANS_PER_DEGREE;
  const phi2 = lat2 * RADIANS_PER_DEGREE;
  const dLambda = (lon2 - lon1) * RADIANS_PER_DEGREE;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return normalizeHeading(Math.atan2(y, x) / RADIANS_PER_DEGREE);
}

/** Курс в [0, 360). */
export function normalizeHeading(degrees: number): number {
  return ((degrees % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG;
}

/** Разность курсов в (−180, 180]. */
export function normalizeSignedDegrees(degrees: number): number {
  const heading = normalizeHeading(degrees);
  return heading > HALF_TURN_DEG ? heading - FULL_TURN_DEG : heading;
}
