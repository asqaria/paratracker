import { readFileSync } from 'node:fs';

import { GEO, type ParsedTrack, type ParseResult, type TrackColumns } from '@skyline/core';
import { parseGpx, parseIgc } from '@skyline/parsing';

/** Помощники тестов analysis: синтетические колонки и фикстуры. Из сборки исключены. */

const FIXTURES = new URL('../../../../fixtures/', import.meta.url);

/** Фикстуры датированы до 22.11.2026 — «сейчас» должно быть позже. */
export const NOW = Date.UTC(2027, 0, 1);

/** Истинные параметры траектории генератора фикстур (tools/make-fixtures.mjs). */
export interface Trajectory {
  cyclePoints: number;
  climbPoints: number;
  climbRateMs: number;
  glideRateMs: number;
  circlePeriodS: number;
  circleRadiusM: number;
  turnDirection: 'cw' | 'ccw';
  turnRateDegS: number;
  glideGroundSpeedMs: number;
  glideTrackDeg: number;
  metresPerDegreeLat: number;
}

interface Expectation {
  pointCount: number;
  date: string;
  samples: { first: { timeUtcSeconds: number } };
  trajectory: Trajectory;
}

const expectations = JSON.parse(readFileSync(new URL('expected.json', FIXTURES), 'utf8')) as Record<string, Expectation>;

export function expectation(name: string): Expectation {
  const exp = expectations[name];
  if (!exp) throw new Error(`No expectation for ${name} in fixtures/expected.json`);
  return exp;
}

function unwrap(result: ParseResult): ParsedTrack {
  if (!result.ok) throw new Error(`parse failed: ${result.code}`);
  return result.track;
}

export function parseFixture(name: string): ParsedTrack {
  const bytes = readFileSync(new URL(name, FIXTURES));
  return unwrap(name.endsWith('.gpx') ? parseGpx(bytes, { now: NOW }) : parseIgc(bytes, { now: NOW }));
}

/** UNIX мс первой точки фикстуры. */
export function fixtureStart(name: string): number {
  const exp = expectation(name);
  return Date.parse(`${exp.date}T00:00:00Z`) + exp.samples.first.timeUtcSeconds * 1000;
}

type Columns = Partial<Record<keyof TrackColumns, ArrayLike<number>>> & { t: ArrayLike<number> };

/** Колонки трека из массивов; незаданные — lat/lon 0, высоты и fxa/siu — NaN, valid — 1. */
export function track(columns: Columns): TrackColumns {
  const n = columns.t.length;
  const float = (values: ArrayLike<number> | undefined, fill: number): Float64Array =>
    values ? Float64Array.from(values) : new Float64Array(n).fill(fill);
  return {
    t: Float64Array.from(columns.t),
    lat: float(columns.lat, 0),
    lon: float(columns.lon, 0),
    altBaro: float(columns.altBaro, Number.NaN),
    altGnss: float(columns.altGnss, Number.NaN),
    valid: columns.valid ? Uint8Array.from(columns.valid) : new Uint8Array(n).fill(1),
    fxa: float(columns.fxa, Number.NaN),
    siu: float(columns.siu, Number.NaN),
  };
}

/** Секунды → мс: [0, 1, 2] → [0, 1000, 2000]. */
export const seconds = (...values: number[]): number[] => values.map((s) => s * 1000);

/** Смещение в метрах от точки (lat, lon) → градусы на сфере GEO.meanEarthRadiusM. */
export function offsetDegrees(lat: number, eastM: number, northM: number): { dLat: number; dLon: number } {
  const radiansToDegrees = 180 / Math.PI;
  return {
    dLat: (northM / GEO.meanEarthRadiusM) * radiansToDegrees,
    dLon: (eastM / (GEO.meanEarthRadiusM * Math.cos(lat / radiansToDegrees))) * radiansToDegrees,
  };
}

export function mean(values: ArrayLike<number>): number {
  const finite = Array.from(values).filter((v) => !Number.isNaN(v));
  return finite.reduce((sum, v) => sum + v, 0) / finite.length;
}

export function median(values: ArrayLike<number>): number {
  const sorted = Array.from(values)
    .filter((v) => !Number.isNaN(v))
    .sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] ?? Number.NaN) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
