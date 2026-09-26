import { CLEAN, GLIDE, MOTION, TIME, type FlightRange, type Glide, type Thermal } from '@skyline/core';

import { haversineDistance, initialBearing } from './geo.js';

/**
 * ТЗ §6.4: глайд — переход от взлёта или конца термика до начала следующего
 * термика или посадки. Первый переход — от старта, последний — финальный глайд
 * до посадки; ходьба по земле до взлёта и после посадки в них не входит.
 * Круги поиска и пузыри, не ставшие термиком, — часть перехода: так делят
 * полёт на «кружение» и «переход» SeeYou и XCTrack, а нарезка кругами дробила
 * бы один перелёт от облака к облаку на куски с завышенным качеством.
 */

export interface GlideColumns {
  /** UNIX-время, мс, UTC. */
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** Сглаженная высота, м. */
  altitude: Float64Array;
}

/** Шаг дольше этого — разрыв записи (ТЗ §5.2): путь через него не пролетался. */
const MAX_LEG_MS = CLEAN.maxInterpolationGapS * TIME.msPerSecond;

function glideBetween(points: GlideColumns, start: number, end: number): Glide {
  const { t, lat, lon, altitude } = points;
  let distanceM = 0;
  for (let i = start + 1; i <= end; i++) {
    if ((t[i] ?? 0) - (t[i - 1] ?? 0) > MAX_LEG_MS) continue;
    distanceM += haversineDistance(lat[i - 1] ?? 0, lon[i - 1] ?? 0, lat[i] ?? 0, lon[i] ?? 0);
  }
  const startTimeMs = t[start] ?? Number.NaN;
  const endTimeMs = t[end] ?? Number.NaN;
  const durationS = (endTimeMs - startTimeMs) / TIME.msPerSecond;
  const altLossM = (altitude[start] ?? Number.NaN) - (altitude[end] ?? Number.NaN);
  const dynamic = !(altLossM >= GLIDE.dynamicMaxAltLossM);

  const [lat0, lon0, lat1, lon1] = [lat[start] ?? 0, lon[start] ?? 0, lat[end] ?? 0, lon[end] ?? 0];
  const straightM = haversineDistance(lat0, lon0, lat1, lon1);
  return {
    startIndex: start,
    endIndex: end,
    startTimeMs,
    endTimeMs,
    durationS,
    distanceM,
    altLossM,
    glideRatio: dynamic ? null : Math.min(GLIDE.maxGlideRatio, distanceM / altLossM),
    kind: dynamic ? 'dynamic' : 'glide',
    avgGroundSpeedMs: distanceM / durationS,
    avgVzMs: -altLossM / durationS,
    // Сместился меньше шума координат — вернулся в точку старта, курса нет.
    headingDeg: straightM < MOTION.minMovementForHeadingM ? Number.NaN : initialBearing(lat0, lon0, lat1, lon1),
    // Через разрыв записи прямая длиннее пройденного пути — не прямее прямой.
    headingConsistency: distanceM > 0 ? Math.min(1, straightM / distanceM) : 0,
  };
}

/**
 * Глайды по найденным термикам (detectThermals) и границам полёта (flightRange).
 * Переходы — промежутки между взлётом, термиками по порядку и посадкой; короче
 * GLIDE.minDurationS — не глайд (из термика сразу в соседний).
 */
export function detectGlides(points: GlideColumns, thermals: readonly Thermal[], range: FlightRange): Glide[] {
  const { takeoff, landing } = range;
  if (takeoff < 0 || landing <= takeoff) return [];

  const glides: Glide[] = [];
  let start = takeoff;
  const close = (end: number): void => {
    const durationS = ((points.t[end] ?? Number.NaN) - (points.t[start] ?? Number.NaN)) / TIME.msPerSecond;
    if (durationS >= GLIDE.minDurationS) glides.push(glideBetween(points, start, end));
  };
  for (const thermal of thermals) {
    if (thermal.endIndex <= takeoff || thermal.startIndex >= landing) continue;
    close(Math.max(start, thermal.startIndex));
    start = Math.max(start, thermal.endIndex);
  }
  close(landing);
  return glides;
}
