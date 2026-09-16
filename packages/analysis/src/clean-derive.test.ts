import { CLEAN, TRACK_FLAGS, VARIO, type DerivedTrack } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { cleanAndDerive } from './clean-derive.js';
import { expectation, fixtureStart, mean, median, parseFixture } from './testing/tracks.js';

/**
 * Приёмка сессии 1.3 на фикстурах. Истинные параметры траектории — из
 * expected.json (trajectory). Сравнение с допуском: IGC квантует минуты до 0.001′
 * (≈1.85 м) и высоту до метра, так что точного равенства с аналитикой нет.
 */

const derive = (name: string): DerivedTrack => cleanAndDerive(parseFixture(name));
const flaggedCount = (flags: Uint8Array, bit: number): number => flags.filter((f) => (f & bit) !== 0).length;

/**
 * Отступ от границ фаз: у генератора на стыке цикла высота и позиция скачут,
 * а окна вариометра и сглаживания не должны его задевать.
 */
const PHASE_MARGIN = VARIO.integralWindowS / 2 + CLEAN.altitudeSmoothingWindow;

describe('baseline.igc', () => {
  const name = 'baseline.igc';
  const result = derive(name);
  const { points } = result;
  const truth = expectation(name).trajectory;
  const start = fixtureStart(name);

  /** Индексы сетки, у которых секунда цикла генератора в [from, to). */
  const cycleRange = (from: number, to: number): number[] => {
    const indices: number[] = [];
    for (let i = 0; i < points.t.length; i++) {
      const cycle = (((points.t[i] ?? 0) - start) / 1000) % truth.cyclePoints;
      if (cycle >= from && cycle < to) indices.push(i);
    }
    return indices;
  };
  const phase = (kind: 'climb' | 'glide'): number[] =>
    kind === 'climb'
      ? cycleRange(PHASE_MARGIN, truth.climbPoints - PHASE_MARGIN)
      : cycleRange(truth.climbPoints + PHASE_MARGIN, truth.cyclePoints - PHASE_MARGIN);
  const pick = (column: Float64Array, indices: number[]): number[] => indices.map((i) => column[i] ?? Number.NaN);

  it('полный анализ, баро, без разрывов, сетка 1 Гц на весь трек', () => {
    expect(result).toMatchObject({ analysisLevel: 'full', altitudeSource: 'baro', gapCount: 0, droppedFixes: 0 });
    expect(result.medianFixIntervalS).toBe(1);
    expect(points.t.length).toBe(expectation(name).pointCount);
    expect(points.t[0]).toBe(start);
    expect(points.t.every((t, i) => i === 0 || t - (points.t[i - 1] ?? 0) === 1000)).toBe(true);
  });

  it('вертикальная скорость в спирали положительна, на переходе отрицательна — все три канала', () => {
    for (const column of [points.vSpeedInstant, points.vSpeedDamped, points.vSpeedIntegral]) {
      expect(pick(column, phase('climb')).every((vz) => vz > 0)).toBe(true);
      expect(pick(column, phase('glide')).every((vz) => vz < 0)).toBe(true);
    }
  });

  it('интегральное варио совпадает с истинной скороподъёмностью и снижением', () => {
    expect(Math.abs(median(pick(points.vSpeedIntegral, phase('climb'))) - truth.climbRateMs)).toBeLessThan(0.05);
    expect(Math.abs(median(pick(points.vSpeedIntegral, phase('glide'))) - truth.glideRateMs)).toBeLessThan(0.05);
  });

  // Здесь среднее, а не медиана: шаг за секунду квантован (восток — 7 или 8 квантов
  // 0.001′ долготы), и медиана выбирает частый вариант со смещением ~2%. Среднее
  // шагов — это полное смещение за время, оно несмещённое.
  it('на переходе путевая скорость и курс совпадают с истинными', () => {
    const glide = phase('glide');
    // Метры генератора — на сфере 6 378 км, наши — 6 371 км: расхождение ≈0.1%, допуск 0.5%.
    expect(Math.abs(mean(pick(points.groundSpeed, glide)) / truth.glideGroundSpeedMs - 1)).toBeLessThan(0.005);
    expect(Math.abs(mean(pick(points.heading, glide)) - truth.glideTrackDeg)).toBeLessThan(0.5);
  });

  // Медианный фильтр координат сплющивает крайние точки тесного круга, и курс за шаг
  // меняется неравномерно — но полный разворот за круг сохраняется. Поэтому среднее
  // по целым кругам: 10 периодов с секунды 20 цикла, вне отступа от границ фазы.
  it('в спирали средняя скорость разворота за целые круги = 360° / период, по часовой — положительная', () => {
    expect(truth.turnDirection).toBe('cw');
    expect(points.turnRate).not.toBeNull();
    const fullCircles = cycleRange(truth.circlePeriodS, truth.circlePeriodS * 11);
    expect(Math.abs(mean(pick(points.turnRate ?? new Float64Array(), fullCircles)) - truth.turnRateDegS)).toBeLessThan(0.1);
  });

  it('сглаженная высота есть у каждой точки', () => {
    expect(points.altitude.some(Number.isNaN)).toBe(false);
  });
});

describe('sparse-10s.igc', () => {
  const result = derive('sparse-10s.igc');

  it("медианный шаг 10 с → analysis_level 'basic', скорость разворота не считается", () => {
    expect(result).toMatchObject({ analysisLevel: 'basic', medianFixIntervalS: 10 });
    expect(result.points.turnRate).toBeNull();
  });

  it('высота, скорость и маршрут всё равно есть — на сетке 1 Гц', () => {
    const { points } = result;
    expect(points.t.length).toBe((expectation('sparse-10s.igc').pointCount - 1) * 10 + 1);
    expect(points.vSpeedIntegral.some(Number.isNaN)).toBe(false);
    expect(points.groundSpeed.some(Number.isNaN)).toBe(false);
  });
});

describe('gaps.igc', () => {
  const { points, gapCount } = derive('gaps.igc');

  it('края разрывов помечены, интерполированных точек внутри разрывов нет', () => {
    expect(gapCount).toBe(2);
    expect(flaggedCount(points.flags, TRACK_FLAGS.gap)).toBe(4);
    const steps = Array.from(points.t.subarray(1), (t, i) => (t - (points.t[i] ?? 0)) / 1000);
    expect(steps.filter((s) => s !== 1)).toEqual([91, 721]);
  });

  it('производные у края разрыва посчитаны только по своему сегменту', () => {
    for (let i = 0; i < points.t.length; i++) {
      if (((points.flags[i] ?? 0) & TRACK_FLAGS.gap) === 0) continue;
      expect(Math.abs(points.vSpeedIntegral[i] ?? Number.NaN)).toBeLessThan(5);
      expect(points.groundSpeed[i] ?? Number.NaN).toBeLessThan(100);
    }
  });
});

describe('прочие фикстуры', () => {
  it('v-fixes.igc: 2D-фиксы помечены на сетке, высота не рвётся', () => {
    const { points } = derive('v-fixes.igc');
    expect(flaggedCount(points.flags, TRACK_FLAGS.fix2d)).toBe(48);
    expect(points.altitude.some(Number.isNaN)).toBe(false);
  });

  it('no-baro.igc: вариометр по GNSS', () => {
    const result = derive('no-baro.igc');
    expect(result.altitudeSource).toBe('gnss');
    expect(result.points.altitude.some(Number.isNaN)).toBe(false);
    expect(result.points.vSpeedInstant.some(Number.isNaN)).toBe(false);
  });

  it('midnight.igc: переход через полночь — не разрыв', () => {
    const { points, gapCount } = derive('midnight.igc');
    expect(gapCount).toBe(0);
    expect(points.t.length).toBe(expectation('midnight.igc').pointCount);
  });

  it('time-offset.gpx: фиксы на .500 с — сетка по целым секундам внутри трека', () => {
    const { points } = derive('time-offset.gpx');
    expect(points.t[0]).toBe(fixtureStart('time-offset.gpx') + 500);
    expect(points.t.length).toBe(expectation('time-offset.gpx').pointCount - 1);
  });
});

describe('чистая функция', () => {
  it('входные колонки не меняются, повторный вызов даёт тот же результат', () => {
    const parsed = parseFixture('baseline.igc');
    const before = { lat: Float64Array.from(parsed.points.lat), altBaro: Float64Array.from(parsed.points.altBaro) };

    const first = cleanAndDerive(parsed);
    const second = cleanAndDerive(parsed);

    expect(parsed.points.lat).toEqual(before.lat);
    expect(parsed.points.altBaro).toEqual(before.altBaro);
    expect(second).toEqual(first);
  });
});
