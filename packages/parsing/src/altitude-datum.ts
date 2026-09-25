import type { GnssAltitudeDatum, TrackColumns } from '@skyline/core';

import { geoidHeightM } from './geoid.js';

/**
 * Код заголовка IGC HF ALG → датум GNSS-высоты.
 * IGC FR Specification, прил. A3: ELL — эллипсоид WGS84, GEO — геоид («approx
 * Sea Level»), NKN — неизвестен, NIL — высота не записана. MSL встречается
 * у приборов вместо GEO. Без заголовка и при NKN — геоид: так парапланерные
 * приборы писали всегда (CIVL Section 7H §3.2.1).
 */
export function igcAltitudeDatum(code: string | null): { datum: GnssAltitudeDatum; recognized: boolean } {
  switch (code?.trim().toUpperCase() ?? null) {
    case 'ELL':
      return { datum: 'ellipsoid', recognized: true };
    case 'GEO':
    case 'MSL':
      return { datum: 'geoid', recognized: true };
    case 'NIL':
      return { datum: 'none', recognized: true };
    case null:
    case '':
    case 'NKN':
      return { datum: 'assumed-geoid', recognized: true };
    default:
      return { datum: 'assumed-geoid', recognized: false };
  }
}

/**
 * Приводит GNSS-высоты к эллипсоиду WGS84 на месте: h = H + N(lat, lon).
 * N считается в точке фикса — там, где высота измерена, до чистки и ресэмплинга.
 * Возвращает датум для meta: none, если GNSS-высоты нет ни в одной точке.
 */
export function applyGnssDatum(points: TrackColumns, datum: GnssAltitudeDatum): GnssAltitudeDatum {
  const { altGnss, lat, lon } = points;
  if (datum === 'none') altGnss.fill(Number.NaN);
  if (datum === 'geoid' || datum === 'assumed-geoid') {
    for (let i = 0; i < altGnss.length; i++) {
      const height = altGnss[i] ?? Number.NaN;
      if (Number.isNaN(height)) continue;
      altGnss[i] = height + geoidHeightM(lat[i] ?? Number.NaN, lon[i] ?? Number.NaN);
    }
  }
  return altGnss.some((height) => !Number.isNaN(height)) ? datum : 'none';
}
