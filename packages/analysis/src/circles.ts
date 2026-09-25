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

/**
 * Поворот курса по шагам. turn[i] — поворот от последнего наблюдаемого курса
 * до курса сегмента i, градусы (плюс — по часовой); NaN — шаг i пропущен
 * (курс не наблюдаем) или с него начинается новое накопление (broken[i] = 1).
 * noise[i] — допуск отката курса на этом шаге (CIRCLE.positionQuantumM).
 *
 * Курс не наблюдаем, если его нет (NaN) или шаг короче minReliableStepM: в
 * сильном ветре пилот раз за круг почти стоит над землёй, и курс по земле там —
 * шум на десятки градусов. Через такие шаги (не дольше maxBridgeS) поворот
 * считается от последнего наблюдаемого курса, а направление берётся от
 * текущего виража: через «стоянку» курс проворачивается быстро и больше чем
 * на 180°, кратчайший поворот дал бы обратный знак.
 */
export interface HeadingTurns {
  turn: Float64Array;
  broken: Uint8Array;
  noise: Float64Array;
}

export function headingTurns(points: CircleColumns): HeadingTurns {
  const n = points.t.length;
  const turn = new Float64Array(n).fill(Number.NaN);
  const broken = new Uint8Array(n);
  const noise = new Float64Array(n).fill(CIRCLE.counterTurnNoiseDeg);
  const stepM = (i: number): number =>
    haversineDistance(
      points.lat[i] ?? Number.NaN,
      points.lon[i] ?? Number.NaN,
      points.lat[i + 1] ?? Number.NaN,
      points.lon[i + 1] ?? Number.NaN,
    );
  const observable = (i: number): boolean =>
    Number.isFinite(points.heading[i] ?? Number.NaN) && stepM(i) >= CIRCLE.minReliableStepM;

  let last = n > 0 && observable(0) ? 0 : -1;
  let lastSign = 0;
  if (n > 0) broken[0] = 1;
  for (let i = 1; i < n; i++) {
    const gridGap = !((points.t[i] ?? Number.NaN) - (points.t[i - 1] ?? Number.NaN) <= GRID_STEP_MS);
    const bridgeTooLong =
      last >= 0 && (points.t[i] ?? Number.NaN) - (points.t[last] ?? Number.NaN) > CIRCLE.maxBridgeS * TIME.msPerSecond;
    if (gridGap || last < 0 || bridgeTooLong) {
      broken[i] = 1;
      last = observable(i) ? i : -1;
      lastSign = 0;
      continue;
    }
    if (!observable(i)) continue;
    let d = normalizeSignedDegrees((points.heading[i] ?? Number.NaN) - (points.heading[last] ?? Number.NaN));
    if (i - last > 1 && lastSign !== 0 && Math.sign(d) === -lastSign) d += lastSign * CIRCLE.fullTurnDeg;
    turn[i] = d;
    const shortest = Math.min(stepM(i), stepM(last));
    noise[i] = Math.max(CIRCLE.counterTurnNoiseDeg, Math.atan(CIRCLE.positionQuantumM / shortest) / DEG);
    if (d !== 0) lastSign = Math.sign(d);
    last = i;
  }
  return { turn, broken, noise };
}

/** Поворот на шаге для накопления: пропущенный шаг ничего не добавляет. */
function turnOf(turns: HeadingTurns, i: number): number {
  const value = turns.turn[i] ?? Number.NaN;
  return Number.isFinite(value) ? value : 0;
}

/** Круги трека по порядку времени; limits — пределы типа ЛА (CIRCLE.paraglider и др.). */
export function detectCircles(points: CircleColumns, limits: CircleLimits): Circle[] {
  const circles: Circle[] = [];
  const minTurnPerStep = minTurningRate(limits) * CLEAN.resampleIntervalS;
  const turns = headingTurns(points);
  let start = -1;
  let sum = 0;
  let previous = -1;

  for (let i = 1; i < points.t.length; i++) {
    if (turns.broken[i]) {
      start = -1;
      sum = 0;
      previous = i;
      continue;
    }
    const turn = turns.turn[i] ?? Number.NaN;
    if (Number.isNaN(turn)) continue;
    // Новое накопление — с предыдущего наблюдаемого сегмента; и при смене направления.
    const reversed = sum !== 0 && Math.sign(turn) === -Math.sign(sum) && Math.abs(turn) > (turns.noise[i] ?? 0);
    if (start < 0 || reversed) {
      start = previous;
      sum = 0;
    }
    previous = i;
    sum += turn;

    while (Math.abs(sum) >= FULL_TURN) {
      // Прямая в начале окна — не часть круга.
      const side = Math.sign(sum);
      while (start < i - 1 && turnOf(turns, start + 1) * side < minTurnPerStep) {
        sum -= turnOf(turns, start + 1);
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
      sum -= turnOf(turns, start + 1);
      start += 1;
    }
  }
  return circles;
}
