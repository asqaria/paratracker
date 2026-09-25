import { GEO, THERMAL, TIME, type Circle, type CircleLimits, type Thermal, type ThermalStrength } from '@skyline/core';

import { minTurningRate, type CircleColumns } from './circles.js';
import { normalizeSignedDegrees } from './geo.js';

/**
 * ТЗ §6.3: термик — круги подряд (разрыв между ними ≤ 15 с) с набором.
 *
 * «≥ 1.5 круга» — а детекция кругов (§6.2) засчитывает только полные. Поэтому
 * к группе кругов добавляется доворот: до первого полного круга и после
 * последнего, пока пилот поворачивает в ту же сторону не медленнее
 * minTurningRate (в среднем за THERMAL.turnRateWindowS). turnCount —
 * полные круги плюс доворот в оборотах; этими же точками ограничен термик:
 * вход в первый вираж и выход на прямую.
 */

export interface ThermalColumns extends CircleColumns {
  /** Демпфированное варио (окно 4 с), м/с — для maxClimb (ТЗ §6.1). */
  vSpeed: Float64Array;
}

const DEG = Math.PI / 180;
const FULL_TURN_DEG = 360;

/** Поворот курса на шаге i в градусах за секунду; NaN — нет курса или разрыв. */
function stepRateAt(points: CircleColumns, i: number): number {
  const dtS = ((points.t[i] ?? Number.NaN) - (points.t[i - 1] ?? Number.NaN)) / TIME.msPerSecond;
  const turn = normalizeSignedDegrees((points.heading[i] ?? Number.NaN) - (points.heading[i - 1] ?? Number.NaN));
  return turn / dtS;
}

/**
 * Средний поворот вокруг шага i за THERMAL.turnRateWindowS, °/с: одиночный шаг
 * с нулевым поворотом (одинаковые курсы после округления) не обрывает вираж.
 * Шаги без курса пропускаются; нет ни одного — NaN.
 */
function turnRateAt(points: CircleColumns, i: number): number {
  const half = Math.floor(THERMAL.turnRateWindowS / 2);
  let sum = 0;
  let count = 0;
  for (let k = i - half; k <= i + half; k++) {
    if (k < 1 || k >= points.t.length) continue;
    const rate = stepRateAt(points, k);
    if (Number.isNaN(rate)) continue;
    sum += rate;
    count += 1;
  }
  return count > 0 ? sum / count : Number.NaN;
}

/** Круги, между которыми не больше maxCircleGapS, — одна группа. */
function groupCircles(circles: readonly Circle[]): Circle[][] {
  const groups: Circle[][] = [];
  for (const circle of circles) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    if (group && last && circle.startTimeMs - last.endTimeMs <= THERMAL.maxCircleGapS * TIME.msPerSecond) group.push(circle);
    else groups.push([circle]);
  }
  return groups;
}

function strengthOf(avgClimbMs: number): ThermalStrength {
  const bounds = THERMAL.strengthUpperBoundsMs;
  if (avgClimbMs < bounds.weak) return 'weak';
  if (avgClimbMs < bounds.medium) return 'medium';
  if (avgClimbMs < bounds.strong) return 'strong';
  return 'powerful';
}

/** Снос по центрам первого и последнего круга, м/с; null — круг один. */
function driftOf(circles: readonly Circle[]): { east: number; north: number } | null {
  const first = circles[0];
  const last = circles.at(-1);
  if (!first || !last || first === last) return null;
  const mid = (c: Circle): number => (c.startTimeMs + c.endTimeMs) / 2;
  const dtS = (mid(last) - mid(first)) / TIME.msPerSecond;
  const mPerDegLat = GEO.meanEarthRadiusM * DEG;
  const mPerDegLon = mPerDegLat * Math.cos(first.centerLat * DEG);
  return {
    east: ((last.centerLon - first.centerLon) * mPerDegLon) / dtS,
    north: ((last.centerLat - first.centerLat) * mPerDegLat) / dtS,
  };
}

/**
 * Термики по уже найденным кругам (detectCircles). limits — пределы типа ЛА:
 * по ним — скорость поворота, которая ещё считается виражом при довороте.
 */
export function detectThermals(points: ThermalColumns, circles: readonly Circle[], limits: CircleLimits): Thermal[] {
  const minTurnRate = minTurningRate(limits);
  const thermals: Thermal[] = [];

  for (const group of groupCircles(circles)) {
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last) continue;
    const turningWith = (rate: number, direction: Circle['direction']): boolean =>
      Math.abs(rate) >= minTurnRate && Math.sign(rate) === (direction === 'cw' ? 1 : -1);

    // Доворот до первого круга: шаги перед ним, пока поворот той же стороны.
    let start = first.startIndex;
    let leading = 0;
    while (start > 0 && leading < FULL_TURN_DEG) {
      if (!turningWith(turnRateAt(points, start), first.direction)) break;
      leading += Math.abs(stepRateAt(points, start));
      start -= 1;
    }
    // …и после последнего — пока пилот не вышел на прямую.
    let end = last.endIndex;
    let trailing = 0;
    while (end + 1 < points.t.length && trailing < FULL_TURN_DEG) {
      if (!turningWith(turnRateAt(points, end + 1), last.direction)) break;
      trailing += Math.abs(stepRateAt(points, end + 1));
      end += 1;
    }

    const turnCount = group.length + (leading + trailing) / FULL_TURN_DEG;
    const startTimeMs = points.t[start] ?? Number.NaN;
    const endTimeMs = points.t[end] ?? Number.NaN;
    const durationS = (endTimeMs - startTimeMs) / TIME.msPerSecond;
    const entryAltM = points.altitude[start] ?? Number.NaN;
    const exitAltM = points.altitude[end] ?? Number.NaN;
    const gainM = exitAltM - entryAltM;
    const avgClimbMs = gainM / durationS;
    if (!(turnCount >= THERMAL.minTurns) || !(avgClimbMs > THERMAL.minAvgClimbMs)) continue;

    let maxClimbMs = Number.NEGATIVE_INFINITY;
    for (let i = start; i <= end; i++) maxClimbMs = Math.max(maxClimbMs, points.vSpeed[i] ?? Number.NEGATIVE_INFINITY);
    const clockwise = group.filter((c) => c.direction === 'cw').length;
    const drift = driftOf(group);

    thermals.push({
      startIndex: start,
      endIndex: end,
      startTimeMs,
      endTimeMs,
      durationS,
      entryAltM,
      exitAltM,
      gainM,
      avgClimbMs,
      maxClimbMs,
      turnCount,
      circleCount: group.length,
      avgRadiusM: group.reduce((sum, c) => sum + c.radiusM, 0) / group.length,
      direction: clockwise * 2 >= group.length ? 'cw' : 'ccw',
      driftEastMs: drift?.east ?? null,
      driftNorthMs: drift?.north ?? null,
      efficiency: avgClimbMs / maxClimbMs,
      strength: strengthOf(avgClimbMs),
    });
  }
  return thermals;
}
