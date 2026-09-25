import { CLEAN, GEO, THERMAL, TIME, type Circle, type CircleLimits, type Thermal, type ThermalStrength } from '@skyline/core';

import { headingTurns, minTurningRate, type CircleColumns, type HeadingTurns } from './circles.js';

/**
 * ТЗ §6.3: термик — круги подряд (разрыв между ними ≤ 15 с) с набором.
 * Разрыв дольше, но с набором (до THERMAL.maxClimbingGapS), — тот же термик:
 * пилот выпал из ядра и ищет его, не выходя из подъёма. И границы термика —
 * не последний круг, а конец набора: после кругов пилот может набирать по прямой.
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

/** Поворот курса на шаге i в градусах за секунду шага; NaN — шаг пропущен или разрыв. */
function stepRateAt(points: CircleColumns, turns: HeadingTurns, i: number): number {
  const dtS = ((points.t[i] ?? Number.NaN) - (points.t[i - 1] ?? Number.NaN)) / TIME.msPerSecond;
  return (turns.turn[i] ?? Number.NaN) / dtS;
}

/**
 * Средний поворот вокруг шага i за THERMAL.turnRateWindowS, °/с: одиночный шаг
 * с нулевым поворотом (одинаковые курсы после округления) не обрывает вираж.
 * Шаги без курса пропускаются; нет ни одного — NaN.
 */
function turnRateAt(points: CircleColumns, turns: HeadingTurns, i: number): number {
  const half = Math.floor(THERMAL.turnRateWindowS / 2);
  let sum = 0;
  let count = 0;
  for (let k = i - half; k <= i + half; k++) {
    if (k < 1 || k >= points.t.length) continue;
    const rate = stepRateAt(points, turns, k);
    if (Number.isNaN(rate)) continue;
    sum += rate;
    count += 1;
  }
  return count > 0 ? sum / count : Number.NaN;
}

/**
 * Круги одной группы: разрыв не больше maxCircleGapS (ТЗ §6.3), или до
 * maxClimbingGapS, если за разрыв пилот набирал — перецентровка, а не переход.
 */
function groupCircles(points: ThermalColumns, circles: readonly Circle[]): Circle[][] {
  const groups: Circle[][] = [];
  for (const circle of circles) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    const gapS = last ? (circle.startTimeMs - last.endTimeMs) / TIME.msPerSecond : Number.POSITIVE_INFINITY;
    const gapClimbMs = last
      ? ((points.altitude[circle.startIndex] ?? Number.NaN) - (points.altitude[last.endIndex] ?? Number.NaN)) / gapS
      : Number.NaN;
    const sameThermal =
      gapS <= THERMAL.maxCircleGapS || (gapS <= THERMAL.maxClimbingGapS && gapClimbMs > THERMAL.minAvgClimbMs);
    if (group && sameThermal) group.push(circle);
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

/** Средний набор между точками a и b, м/с; NaN — между ними разрыв сетки или нет высоты. */
function climbBetween(points: ThermalColumns, a: number, b: number): number {
  const dtS = ((points.t[b] ?? Number.NaN) - (points.t[a] ?? Number.NaN)) / TIME.msPerSecond;
  if (!(dtS > 0) || dtS > (b - a) * CLIMB_GRID_TOLERANCE) return Number.NaN;
  return ((points.altitude[b] ?? Number.NaN) - (points.altitude[a] ?? Number.NaN)) / dtS;
}

/** Шаг сетки 1 Гц с запасом: окно длиннее — в нём разрыв. */
const CLIMB_GRID_TOLERANCE = 1.5;

/**
 * Отрезок будущего термика: границы, его круги и доворот в оборотах.
 * climbStart/climbEnd — докуда от крайних кругов не прерывался набор: по ним
 * решается, один ли это подъём с соседним отрезком.
 */
interface Span {
  start: number;
  end: number;
  climbStart: number;
  climbEnd: number;
  circles: Circle[];
  partialTurns: number;
}

/**
 * Термики по уже найденным кругам (detectCircles). limits — пределы типа ЛА:
 * по ним — скорость поворота, которая ещё считается виражом при довороте.
 *
 * Порядок: группы кругов → доворот до первого и после последнего круга →
 * расширение, пока идёт набор (THERMAL.climbWindowS) → отрезки, которые
 * сомкнулись, — один термик (подъём между ними не прерывался) → условия §6.3.
 */
export function detectThermals(points: ThermalColumns, circles: readonly Circle[], limits: CircleLimits): Thermal[] {
  const minTurnRate = minTurningRate(limits);
  const turns = headingTurns(points);
  const window = Math.max(1, Math.round(THERMAL.climbWindowS / CLEAN.resampleIntervalS));
  const n = points.t.length;
  const stepTurn = (i: number): number => {
    const rate = stepRateAt(points, turns, i);
    return Number.isFinite(rate) ? Math.abs(rate) : 0;
  };

  const spans: Span[] = [];
  for (const group of groupCircles(points, circles)) {
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last) continue;
    const turningWith = (rate: number, direction: Circle['direction']): boolean =>
      Math.abs(rate) >= minTurnRate && Math.sign(rate) === (direction === 'cw' ? 1 : -1);

    // Доворот до первого круга: шаги перед ним, пока поворот той же стороны.
    let start = first.startIndex;
    let leading = 0;
    while (start > 0 && leading < FULL_TURN_DEG) {
      if (!turningWith(turnRateAt(points, turns, start), first.direction)) break;
      leading += stepTurn(start);
      start -= 1;
    }
    // …и после последнего — пока пилот не вышел на прямую.
    let end = last.endIndex;
    let trailing = 0;
    while (end + 1 < n && trailing < FULL_TURN_DEG) {
      if (!turningWith(turnRateAt(points, turns, end + 1), last.direction)) break;
      trailing += stepTurn(end + 1);
      end += 1;
    }
    // Термик длится, пока идёт набор — и по прямой тоже (под облаком, в ядре без кругов).
    let climbEnd = last.endIndex;
    while (climbEnd + window < n && climbBetween(points, climbEnd, climbEnd + window) > THERMAL.minAvgClimbMs) climbEnd += 1;
    let climbStart = first.startIndex;
    while (climbStart - window >= 0 && climbBetween(points, climbStart - window, climbStart) > THERMAL.minAvgClimbMs) {
      climbStart -= 1;
    }

    spans.push({
      start: Math.min(start, climbStart),
      end: Math.max(end, climbEnd),
      climbStart,
      climbEnd,
      circles: [...group],
      partialTurns: (leading + trailing) / FULL_TURN_DEG,
    });
  }

  // Набор между отрезками не прерывался — один термик. Сомкнулись только
  // доворотами (пилот медленно крутил, снижаясь) — два, граница по началу второго.
  const merged: Span[] = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && span.climbStart <= previous.climbEnd) {
      previous.end = Math.max(previous.end, span.end);
      previous.climbEnd = Math.max(previous.climbEnd, span.climbEnd);
      previous.circles.push(...span.circles);
      previous.partialTurns += span.partialTurns;
      continue;
    }
    if (previous && span.start < previous.end) previous.end = span.start;
    merged.push({ ...span, circles: [...span.circles] });
  }

  const thermals: Thermal[] = [];
  for (const { start, end, circles: group, partialTurns } of merged) {
    const turnCount = group.length + partialTurns;
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
