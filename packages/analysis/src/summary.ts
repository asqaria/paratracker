import { CLEAN, type FlightSummary } from '@skyline/core';

import { haversineDistance } from './geo.js';

/** Колонки, по которым считается сводка: очищенный трек или колонки .track. */
export interface SummaryColumns {
  /** UNIX-время, мс, UTC. */
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** Высота, м; NaN — нет значения. */
  alt: Float64Array;
}

const MS_PER_SECOND = 1000;
/** Шаг дольше этого — разрыв (ТЗ §5.2): отрезок через него не пролетался. */
const MAX_LEG_MS = CLEAN.maxInterpolationGapS * MS_PER_SECOND;

/**
 * Сводка полёта (ТЗ §5.2 шаг 7, задача 1.13) за один проход O(n).
 * Макс. набор — бегущий минимум: для каждой точки прирост от самой низкой
 * точки до неё, поэтому минимум после максимума набор не завышает.
 */
export function summarizeFlight(columns: SummaryColumns): FlightSummary {
  const { t, lat, lon, alt } = columns;
  const count = t.length;
  let distanceTrackM = 0;
  let maxAltM = Number.NaN;
  let maxGainM = 0;
  let minAltSoFar = Number.POSITIVE_INFINITY;

  for (let i = 0; i < count; i++) {
    if (i > 0 && (t[i] ?? 0) - (t[i - 1] ?? 0) <= MAX_LEG_MS) {
      distanceTrackM += haversineDistance(lat[i - 1] ?? 0, lon[i - 1] ?? 0, lat[i] ?? 0, lon[i] ?? 0);
    }

    const altitude = alt[i] ?? Number.NaN;
    if (Number.isNaN(altitude)) continue;
    if (Number.isNaN(maxAltM) || altitude > maxAltM) maxAltM = altitude;
    if (altitude < minAltSoFar) minAltSoFar = altitude;
    if (altitude - minAltSoFar > maxGainM) maxGainM = altitude - minAltSoFar;
  }

  const durationS = count > 0 ? ((t[count - 1] ?? 0) - (t[0] ?? 0)) / MS_PER_SECOND : 0;
  return { durationS, maxAltM, distanceTrackM, maxGainM };
}
