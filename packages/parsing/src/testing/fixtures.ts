import { readFileSync } from 'node:fs';

import { pointAt, type DateSource, type GnssAltitudeDatum, type ParsedTrack, type ParseResult } from '@skyline/core';
import { expect, it } from 'vitest';

/**
 * Общие контрольные проверки парсеров по fixtures/expected.json — одинаковые
 * для IGC, GPX и KML, чтобы форматы не расходились в том, что считается «правильно».
 */

const FIXTURES = new URL('../../../../fixtures/', import.meta.url);

/** Эталоны сверяются с допуском 1e-9, а не «примерно» (CLAUDE.md). */
export const TOLERANCE_DEG = 1e-9;
/** То же для высот, м: эталон altGnss — над эллипсоидом, посчитан генератором по EGM96. */
export const TOLERANCE_M = 1e-9;

/** Фикстуры датированы до 22.11.2026 (south-west.igc) — «сейчас» должно быть позже. */
export const NOW = Date.UTC(2027, 0, 1);

export type FixtureFormat = 'igc' | 'gpx' | 'kml' | 'kmz';

interface Sample {
  index: number;
  timeUtcSeconds: number;
  lat: number;
  lon: number;
  altBaro: number | null;
  altGnss: number | null;
  valid: boolean;
}

export interface FixtureExpectation {
  format: FixtureFormat;
  pointCount: number;
  date: string;
  dateHeaderRaw: string | null;
  altitudeSource: 'baro' | 'gnss';
  gnssAltitudeDatum: GnssAltitudeDatum;
  iRecord: string | null;
  medianFixIntervalSeconds: number;
  maxFixIntervalSeconds: number;
  invalidFixCount: number;
  minWarnings: number;
  samples: { first: Sample; middle: Sample; last: Sample };
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
    minAlt: number | null;
    maxAlt: number | null;
  };
}

const expectations = JSON.parse(readFileSync(new URL('expected.json', FIXTURES), 'utf8')) as Record<
  string,
  FixtureExpectation
>;

export function fixtureCases(...formats: FixtureFormat[]): [string, FixtureExpectation][] {
  return Object.entries(expectations).filter(([, exp]) => formats.includes(exp.format));
}

export function expectation(name: string): FixtureExpectation {
  const exp = expectations[name];
  if (!exp) throw new Error(`No expectation for ${name} in fixtures/expected.json`);
  return exp;
}

export const readFixture = (name: string): Uint8Array => readFileSync(new URL(name, FIXTURES));
export const readFixtureText = (name: string): string => readFileSync(new URL(name, FIXTURES), 'utf8');

export function unwrap(result: ParseResult): ParsedTrack {
  if (!result.ok) throw new Error(`parse failed: ${result.code}`);
  return result.track;
}

export function expectDegrees(actual: number, wanted: number, label: string): void {
  expect(Math.abs(actual - wanted), `${label}: ${actual} vs ${wanted}`).toBeLessThanOrEqual(TOLERANCE_DEG);
}

/** Высота в метрах против эталона: null — высоты нет, иначе допуск TOLERANCE_M. */
export function expectMetres(actual: number | null, expected: number | null): void {
  if (expected === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(actual).not.toBeNull();
  expect(Math.abs((actual ?? Number.NaN) - expected)).toBeLessThanOrEqual(TOLERANCE_M);
}

/** Регистрирует контрольные проверки внутри текущего describe. */
export function defineFixtureChecks(track: ParsedTrack, exp: FixtureExpectation, dateSource: DateSource): void {
  const { points } = track;
  const count = points.t.length;
  const dayStart = Date.parse(`${exp.date}T00:00:00Z`);

  it('количество точек, источник высоты, 2D-фиксы', () => {
    expect(count).toBe(exp.pointCount);
    expect(track.altitudeSource).toBe(exp.altitudeSource);
    expect(points.valid.filter((v) => v === 0).length).toBe(exp.invalidFixCount);
    const { t, lat, lon, altBaro, altGnss, valid, fxa, siu } = points;
    for (const column of [t, lat, lon, altBaro, altGnss, valid, fxa, siu]) expect(column.length).toBe(count);
  });

  it('дата', () => {
    expect(track.meta).toMatchObject({ date: exp.date, dateSource });
    // GPX и KML заполняют датум в задаче 4 плана высот; до неё сверяется только IGC.
    if (exp.format === 'igc') expect(track.meta.gnssAltitudeDatum).toBe(exp.gnssAltitudeDatum);
  });

  it.each(['first', 'middle', 'last'] as const)('контрольная точка %s', (key) => {
    const sample = exp.samples[key];
    const point = pointAt(points, sample.index);

    expect(point.t).toBe(dayStart + sample.timeUtcSeconds * 1000);
    expectDegrees(point.lat, sample.lat, 'lat');
    expectDegrees(point.lon, sample.lon, 'lon');
    expect(point.altBaro).toBe(sample.altBaro);
    expectMetres(point.altGnss, sample.altGnss);
    expect(point.valid).toBe(sample.valid);
  });

  it('границы по всем точкам', () => {
    expectDegrees(Math.min(...points.lat), exp.bounds.minLat, 'minLat');
    expectDegrees(Math.max(...points.lat), exp.bounds.maxLat, 'maxLat');
    expectDegrees(Math.min(...points.lon), exp.bounds.minLon, 'minLon');
    expectDegrees(Math.max(...points.lon), exp.bounds.maxLon, 'maxLon');
    if (exp.bounds.minAlt === null || exp.bounds.maxAlt === null) {
      expect(points.altGnss.every(Number.isNaN)).toBe(true);
    } else {
      expectMetres(Math.min(...points.altGnss), exp.bounds.minAlt);
      expectMetres(Math.max(...points.altGnss), exp.bounds.maxAlt);
    }
  });

  it('интервалы между фиксами', () => {
    const steps = Array.from(points.t.subarray(1), (t, i) => (t - (points.t[i] ?? 0)) / 1000).sort((a, b) => a - b);
    expect(steps.every((s) => s > 0)).toBe(true);
    expect(steps[Math.floor(steps.length / 2)]).toBe(exp.medianFixIntervalSeconds);
    expect(steps.at(-1)).toBe(exp.maxFixIntervalSeconds);
  });

  it('предупреждений не меньше эталона', () => {
    expect(track.warnings.length).toBeGreaterThanOrEqual(exp.minWarnings);
  });
}
