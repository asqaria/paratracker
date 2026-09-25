import { CIRCLE, CLEAN, GEO, TIME, type Circle, type CircleLimits } from '@skyline/core';

import { haversineDistance, normalizeSignedDegrees } from './geo.js';

/**
 * ТЗ §6.2: детекция кругов (виражей) по накоплению поворота курса.
 *
 * heading[i] — курс от точки i к i+1 (computeMotion). Поворот Δ[i] —
 * нормализованная в (−180, 180] разность heading[i] − heading[i−1].
 * Поворот копится, пока знак не меняется; набралось 360° — полный круг
 * от точки start до точки i. Круг проверяется отсечками §6.2 (радиус,
 * период по типу ЛА): не прошёл — начало окна сдвигается вперёд, пока
 * в окне ещё 360°. Так долгий плавный доворот перед спиралью не мешает
 * найти в ней круги. Засчитанный круг обнуляет накопление: круги идут встык.
 *
 * Сброс накопления: смена направления поворота (§6.2: «направление не
 * меняется внутри круга»), нет курса (стоит, NaN) и разрыв сетки. Откат
 * курса меньше CIRCLE.counterTurnNoiseDeg за шаг — шум округления координат,
 * а не смена направления: иначе на реальных IGC терялся каждый десятый круг.
 * Круг не начинается с прямой: поворот на прямой — ровно 0 и накопление не
 * сбрасывает, поэтому перед замером начало окна подрезается до первого шага,
 * где пилот поворачивает (minTurningRate).
 *
 * Центр и радиус — не «среднее точек и медиана расстояний» из §6.2, а подгонка
 * x(τ) = a + b·τ + A·sin ωτ + B·cos ωτ по каждой оси. ω — фактическая угловая
 * скорость (накопленный поворот / длительность): окно из целых секунд
 * пересекает 360° с перебором до шага, и ω = 2π/период завышала бы радиус. В термике
 * круг сносит ветром, и за оборот центр уезжает на десятки метров. Медиана
 * расстояний до среднего от этого врёт на ±5 м в зависимости от того, с какой
 * фазы начался оборот; подгонка даёт радиус в сносе и центр в середине оборота.
 */

export interface CircleColumns {
  /** UTC, мс, сетка 1 Гц (ТЗ §5.2). */
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** Сглаженная высота, м. */
  altitude: Float64Array;
  /** Курс от точки к следующей, [0, 360); NaN — курса нет. */
  heading: Float64Array;
}

const GRID_STEP_MS = CLEAN.resampleIntervalS * TIME.msPerSecond;

/** Угловая скорость, ниже которой пилот не поворачивает, °/с (CIRCLE.turningRateFraction). */
export function minTurningRate(limits: CircleLimits): number {
  return (CIRCLE.fullTurnDeg / limits.maxPeriodS) * CIRCLE.turningRateFraction;
}
const FULL_TURN = CIRCLE.fullTurnDeg - CIRCLE.closureToleranceDeg;

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] ?? Number.NaN) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const DEG = Math.PI / 180;
const FIT_TERMS = 4;

/** Решение системы 4×4 методом Гаусса с выбором ведущего; null — вырождена. */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const a = matrix.map((row, i) => [...row, rhs[i] ?? 0]);
  for (let col = 0; col < FIT_TERMS; col++) {
    let pivot = col;
    for (let row = col + 1; row < FIT_TERMS; row++) {
      if (Math.abs(a[row]?.[col] ?? 0) > Math.abs(a[pivot]?.[col] ?? 0)) pivot = row;
    }
    const lead = a[pivot]?.[col] ?? 0;
    if (Math.abs(lead) < Number.EPSILON) return null;
    [a[col], a[pivot]] = [a[pivot] ?? [], a[col] ?? []];
    for (let row = 0; row < FIT_TERMS; row++) {
      if (row === col) continue;
      const factor = (a[row]?.[col] ?? 0) / lead;
      for (let k = col; k <= FIT_TERMS; k++) (a[row] as number[])[k] = (a[row]?.[k] ?? 0) - factor * (a[col]?.[k] ?? 0);
    }
  }
  return a.map((row, i) => (row[FIT_TERMS] ?? 0) / (row[i] ?? 1));
}

/** Центр (в середине оборота) и радиус по точкам [start, end); null — подгонка не сошлась. */
function fitCircle(
  points: CircleColumns,
  start: number,
  end: number,
  omegaRadS: number,
): { centerLat: number; centerLon: number; radiusM: number } | null {
  const lat0 = points.lat[start] ?? Number.NaN;
  const lon0 = points.lon[start] ?? Number.NaN;
  const mPerDegLat = GEO.meanEarthRadiusM * DEG;
  const mPerDegLon = mPerDegLat * Math.cos(lat0 * DEG);
  let midMs = 0;
  for (let i = start; i < end; i++) midMs += points.t[i] ?? Number.NaN;
  midMs /= end - start;

  const omega = omegaRadS;
  const normal = Array.from({ length: FIT_TERMS }, () => new Array<number>(FIT_TERMS).fill(0));
  const rhsEast = new Array<number>(FIT_TERMS).fill(0);
  const rhsNorth = new Array<number>(FIT_TERMS).fill(0);
  for (let i = start; i < end; i++) {
    const tau = ((points.t[i] ?? Number.NaN) - midMs) / TIME.msPerSecond;
    const row = [1, tau, Math.sin(omega * tau), Math.cos(omega * tau)];
    const east = ((points.lon[i] ?? Number.NaN) - lon0) * mPerDegLon;
    const north = ((points.lat[i] ?? Number.NaN) - lat0) * mPerDegLat;
    for (let r = 0; r < FIT_TERMS; r++) {
      for (let c = 0; c < FIT_TERMS; c++) (normal[r] as number[])[c] = (normal[r]?.[c] ?? 0) + (row[r] ?? 0) * (row[c] ?? 0);
      rhsEast[r] = (rhsEast[r] ?? 0) + (row[r] ?? 0) * east;
      rhsNorth[r] = (rhsNorth[r] ?? 0) + (row[r] ?? 0) * north;
    }
  }
  const e = solve(normal, rhsEast);
  const n = solve(normal, rhsNorth);
  if (!e || !n) return null;
  const radiusM = (Math.hypot(e[2] ?? 0, e[3] ?? 0) + Math.hypot(n[2] ?? 0, n[3] ?? 0)) / 2;
  const result = { centerLat: lat0 + (n[0] ?? 0) / mPerDegLat, centerLon: lon0 + (e[0] ?? 0) / mPerDegLon, radiusM };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

/** Запасной вариант §6.2 как есть: центр — среднее точек, радиус — медиана расстояний. */
function meanCircle(points: CircleColumns, start: number, end: number): { centerLat: number; centerLon: number; radiusM: number } {
  let lat = 0;
  let lon = 0;
  for (let i = start; i < end; i++) {
    lat += points.lat[i] ?? Number.NaN;
    lon += points.lon[i] ?? Number.NaN;
  }
  const centerLat = lat / (end - start);
  const centerLon = lon / (end - start);
  const distances: number[] = [];
  for (let i = start; i < end; i++) {
    distances.push(haversineDistance(centerLat, centerLon, points.lat[i] ?? Number.NaN, points.lon[i] ?? Number.NaN));
  }
  return { centerLat, centerLon, radiusM: median(distances) };
}

/**
 * Круг из точек [start, end]: центр и радиус — по обороту [start, end), без повтора фазы.
 * turnDeg — накопленный поворот курса (знак — направление).
 */
function measure(points: CircleColumns, start: number, end: number, turnDeg: number): Circle {
  const startTimeMs = points.t[start] ?? Number.NaN;
  const endTimeMs = points.t[end] ?? Number.NaN;
  const periodS = (endTimeMs - startTimeMs) / TIME.msPerSecond;
  const omega = (Math.abs(turnDeg) * DEG) / periodS;
  const geometry = fitCircle(points, start, end, omega) ?? meanCircle(points, start, end);
  const direction: Circle['direction'] = turnDeg > 0 ? 'cw' : 'ccw';
  return {
    startIndex: start,
    endIndex: end,
    startTimeMs,
    endTimeMs,
    periodS,
    direction,
    ...geometry,
    gainM: (points.altitude[end] ?? Number.NaN) - (points.altitude[start] ?? Number.NaN),
  };
}

const withinLimits = (circle: Circle, limits: CircleLimits): boolean =>
  circle.radiusM >= limits.minRadiusM &&
  circle.radiusM <= limits.maxRadiusM &&
  circle.periodS >= limits.minPeriodS &&
  circle.periodS <= limits.maxPeriodS;

/** Поворот курса на шаге i (от сегмента i−1 к сегменту i); NaN — поворота нет. */
function turnAt(points: CircleColumns, i: number): number {
  const stepMs = (points.t[i] ?? Number.NaN) - (points.t[i - 1] ?? Number.NaN);
  if (!(stepMs <= GRID_STEP_MS)) return Number.NaN;
  return normalizeSignedDegrees((points.heading[i] ?? Number.NaN) - (points.heading[i - 1] ?? Number.NaN));
}

/** Круги трека по порядку времени; limits — пределы типа ЛА (CIRCLE.paraglider и др.). */
export function detectCircles(points: CircleColumns, limits: CircleLimits): Circle[] {
  const circles: Circle[] = [];
  const minTurnPerStep = minTurningRate(limits) * CLEAN.resampleIntervalS;
  let start = -1;
  let sum = 0;

  for (let i = 1; i < points.t.length; i++) {
    const turn = turnAt(points, i);
    if (Number.isNaN(turn)) {
      start = -1;
      sum = 0;
      continue;
    }
    // Новое накопление — с сегмента i−1; и при смене направления поворота тоже.
    const reversed = sum !== 0 && Math.sign(turn) === -Math.sign(sum) && Math.abs(turn) > CIRCLE.counterTurnNoiseDeg;
    if (start < 0 || reversed) {
      start = i - 1;
      sum = 0;
    }
    sum += turn;

    while (Math.abs(sum) >= FULL_TURN) {
      // Прямая в начале окна — не часть круга.
      const side = Math.sign(sum);
      while (start < i - 1 && turnAt(points, start + 1) * side < minTurnPerStep) {
        sum -= turnAt(points, start + 1);
        start += 1;
      }
      if (Math.abs(sum) < FULL_TURN) break;
      // Слишком долгий оборот отсекается сразу, без подгонки: на длинном пологом
      // развороте окно сжимается шаг за шагом, и подгонка на каждом шаге стоила бы O(окно²).
      const periodS = ((points.t[i] ?? Number.NaN) - (points.t[start] ?? Number.NaN)) / TIME.msPerSecond;
      const circle = periodS <= limits.maxPeriodS ? measure(points, start, i, sum) : null;
      if (circle && withinLimits(circle, limits)) {
        circles.push(circle);
        start = i;
        sum = 0;
        break;
      }
      // Не круг: окно сжимается с начала, пока в нём ещё полный оборот.
      sum -= turnAt(points, start + 1);
      start += 1;
    }
  }
  return circles;
}
