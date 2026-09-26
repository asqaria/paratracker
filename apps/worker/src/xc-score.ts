import { XC, type FlightRange, type XcPoint, type XcScore, type XcType } from '@skyline/core';
import { scoringRules, solver } from 'igc-xc-score';

/**
 * XC-скоринг (ТЗ §6.6, задача 3.1) — igc-xc-score, вызов в потоке конвейера.
 * Живёт в воркере, а не в packages/analysis: analysis зависит только от core
 * (CLAUDE.md), а библиотека — обычная внешняя зависимость (ТЗ §6.6).
 *
 * Трек отдаётся уже очищенным и обрезанным по взлёту и посадке из flightRange:
 * очки считаются по тому же полёту, что вся аналитика, а не по своей
 * детекции взлёта библиотеки. Перебор ограничен итерациями (XC), не временем:
 * результат детерминирован.
 */

export interface XcColumns {
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  altitude: Float64Array;
}

/** Меньше — библиотека отказывается считать (flight.js: «valid fixes found»). */
const MIN_FIXES = 5;
const METRES_PER_KM = 1000;
const TYPE_BY_CODE: Record<string, XcType> = { od: 'free_distance', tri: 'free_triangle', fai: 'fai_triangle' };

/** Фикс в формате igc-parser — ровно те поля, что читает решатель. */
interface SolverFix {
  timestamp: number;
  latitude: number;
  longitude: number;
  valid: boolean;
  pressureAltitude: number;
  gpsAltitude: number;
}

/** Точка решения библиотеки: x — долгота, y — широта, r — номер фикса в переданном массиве. */
interface SolverPoint {
  x: number;
  y: number;
  r?: number;
}

export function scoreXc(columns: XcColumns, range: FlightRange, rules: string = XC.defaultRules): XcScore | null {
  const fixes: SolverFix[] = [];
  for (let i = range.takeoff; i <= range.landing; i++) {
    const lat = columns.lat[i];
    const lon = columns.lon[i];
    const t = columns.t[i];
    if (lat === undefined || lon === undefined || t === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const alt = columns.altitude[i] ?? 0;
    fixes.push({ timestamp: t, latitude: lat, longitude: lon, valid: true, pressureAltitude: alt, gpsAltitude: alt });
  }
  if (fixes.length < MIN_FIXES) return null;

  const ruleSet = scoringRules[rules];
  if (!ruleSet) throw new Error(`Unknown XC rules: ${rules}`);
  // Формат IGCFile из igc-parser: решателю нужны только фиксы.
  const run = solver({ fixes } as unknown as Parameters<typeof solver>[0], ruleSet, { maxloop: XC.loopsPerStep, trim: false });
  let step = run.next();
  for (let n = 1; !step.done && !step.value.optimal && n < XC.maxSteps; n++) step = run.next();

  const best = step.value;
  const info = best.scoreInfo;
  const type = TYPE_BY_CODE[best.opt.scoring.code];
  if (!info || !type) return null;

  const at = (p: SolverPoint): XcPoint => ({
    lat: p.y,
    lon: p.x,
    timeMs: p.r === undefined ? Number.NaN : (fixes[p.r]?.timestamp ?? Number.NaN),
  });
  const turnpoints = (info.tp ?? []).map(at);
  const route = type === 'free_distance' && info.ep ? [at(info.ep.start), ...turnpoints, at(info.ep.finish)] : turnpoints;

  return {
    rules,
    type,
    name: best.opt.scoring.name,
    distanceM: Math.round(info.distance * METRES_PER_KM),
    score: info.score,
    multiplier: best.opt.scoring.multiplier,
    optimal: best.optimal === true,
    route,
    closing: info.cp ? { in: at(info.cp.in), out: at(info.cp.out), distanceM: Math.round(info.cp.d * METRES_PER_KM) } : null,
  };
}
