import type { FlightSummary } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { cleanAndDerive } from './clean-derive.js';
import { haversineDistance } from './geo.js';
import { summarizeFlight, type SummaryColumns } from './summary.js';
import { expectation, parseFixture, seconds } from './testing/tracks.js';

/** Эталон — fixtures/expected.json (summary), посчитан генератором по записанным в файл точкам. */
const EXACT = 1e-9;

const columns = (values: { t: number[]; lat?: number[]; lon?: number[]; alt?: number[] }): SummaryColumns => ({
  t: Float64Array.from(values.t),
  lat: Float64Array.from(values.lat ?? values.t.map(() => 0)),
  lon: Float64Array.from(values.lon ?? values.t.map(() => 0)),
  alt: Float64Array.from(values.alt ?? values.t.map(() => Number.NaN)),
});

function summaryOf(name: string): FlightSummary {
  const summary = expectation(name).summary;
  if (!summary) throw new Error(`No summary for ${name} in fixtures/expected.json`);
  return summary;
}

const expectSummary = (actual: FlightSummary, expected: FlightSummary): void => {
  expect(actual.durationS).toBeCloseTo(expected.durationS, 9);
  expect(Math.abs(actual.maxAltM - expected.maxAltM)).toBeLessThanOrEqual(EXACT);
  expect(Math.abs(actual.distanceTrackM - expected.distanceTrackM)).toBeLessThanOrEqual(EXACT);
  expect(Math.abs(actual.maxGainM - expected.maxGainM)).toBeLessThanOrEqual(EXACT);
};

describe('summarizeFlight на фикстурах — точно до 1e-9', () => {
  it.each(['baseline.igc', 'gaps.igc', 'no-baro.igc', 'midnight.igc'])('%s', (name) => {
    const { points, altitudeSource } = parseFixture(name);
    const alt = altitudeSource === 'baro' ? points.altBaro : points.altGnss;
    const expected = summaryOf(name);
    expectSummary(summarizeFlight({ t: points.t, lat: points.lat, lon: points.lon, alt }), expected);
  });
});

describe('summarizeFlight после чистки — то, что видит пилот', () => {
  /**
   * Сглаживание Савицкого–Голея срезает излом «набор → переход» на вершине
   * на единицы метров, медианный фильтр спрямляет дугу спирали на доли процента.
   * Точного равенства с сырым треком здесь нет и быть не должно.
   */
  it.each(['baseline.igc', 'gaps.igc'])('%s: близко к сводке сырого трека', (name) => {
    const { points } = cleanAndDerive(parseFixture(name));
    const expected = summaryOf(name);
    const actual = summarizeFlight({ t: points.t, lat: points.lat, lon: points.lon, alt: points.altitude });
    expect(actual.durationS).toBe(expected.durationS);
    expect(Math.abs(actual.maxAltM - expected.maxAltM)).toBeLessThan(3);
    expect(Math.abs(actual.maxGainM - expected.maxGainM)).toBeLessThan(3);
    expect(Math.abs(actual.distanceTrackM / expected.distanceTrackM - 1)).toBeLessThan(0.01);
  });
});

describe('summarizeFlight — граничные случаи', () => {
  it('пустой трек — нули и NaN, без исключения', () => {
    expect(summarizeFlight(columns({ t: [] }))).toEqual({
      durationS: 0,
      maxAltM: Number.NaN,
      distanceTrackM: 0,
      maxGainM: 0,
    });
  });

  it('одна точка — длительность и дистанция 0, высота есть', () => {
    expect(summarizeFlight(columns({ t: seconds(0), alt: [1200] }))).toEqual({
      durationS: 0,
      maxAltM: 1200,
      distanceTrackM: 0,
      maxGainM: 0,
    });
  });

  it('только снижение — набор 0', () => {
    expect(summarizeFlight(columns({ t: seconds(0, 1, 2), alt: [1500, 1400, 1300] })).maxGainM).toBe(0);
  });

  it('набор ищется от минимума ДО максимума, а не от глобального минимума', () => {
    // глобальный минимум 900 — после максимума, от него вверх только 100 м
    const summary = summarizeFlight(columns({ t: seconds(0, 1, 2, 3, 4), alt: [1000, 1300, 1600, 900, 1000] }));
    expect(summary).toMatchObject({ maxAltM: 1600, maxGainM: 600 });
  });

  it('NaN в высоте пропускается и не рвёт поиск набора', () => {
    const summary = summarizeFlight(columns({ t: seconds(0, 1, 2, 3), alt: [1000, Number.NaN, 1250, Number.NaN] }));
    expect(summary).toMatchObject({ maxAltM: 1250, maxGainM: 250 });
  });

  it('высоты нет совсем — maxAlt NaN, набор 0, дистанция считается', () => {
    const summary = summarizeFlight(columns({ t: seconds(0, 1), lat: [43, 43.001], lon: [77, 77] }));
    expect(summary.maxAltM).toBeNaN();
    expect(summary.maxGainM).toBe(0);
    expect(summary.distanceTrackM).toBeCloseTo(haversineDistance(43, 77, 43.001, 77), 9);
  });

  it('разрыв дольше порога интерполяции в дистанцию не входит, в длительность — входит', () => {
    const summary = summarizeFlight(
      columns({ t: seconds(0, 1, 91, 92), lat: [43, 43.001, 43.1, 43.101], lon: [77, 77, 77, 77] }),
    );
    const leg = haversineDistance(43, 77, 43.001, 77);
    const legAfterGap = haversineDistance(43.1, 77, 43.101, 77);
    expect(Math.abs(summary.distanceTrackM - (leg + legAfterGap))).toBeLessThanOrEqual(EXACT);
    expect(summary.durationS).toBe(92);
  });

  it('детерминирована: тот же вход — тот же выход', () => {
    const input = columns({ t: seconds(0, 1, 2), lat: [43, 43.0005, 43.001], lon: [77, 77.001, 77], alt: [1, 5, 3] });
    expect(summarizeFlight(input)).toEqual(summarizeFlight(input));
  });
});
