import { CIRCLE, GLIDE, WIND, type AircraftType, type DerivedTrack, type FlightAnalysis, type ThermalSegment } from '@skyline/core';

import { detectCircles } from './circles.js';
import { flightRange } from './flight-range.js';
import { detectGlides } from './glides.js';
import { detectThermals } from './thermals.js';
import { estimateWind } from './wind.js';

/**
 * Анализ полёта целиком (ТЗ §5.2 шаги 5–6): круги → термики → взлёт и посадка →
 * глайды → ветер, плюс агрегаты для flights. Чистая функция: воркер вызывает её
 * в потоке и пишет результат в базу.
 *
 * null — трек 'basic' (медианный шаг > 4 с, §5.2): интерполяция срезает виражи
 * хордами, круги и ветер по нему не ищутся.
 */
export function analyseFlight(track: DerivedTrack, aircraft: AircraftType): FlightAnalysis | null {
  if (track.analysisLevel !== 'full') return null;
  const p = track.points;
  const columns = { t: p.t, lat: p.lat, lon: p.lon, altitude: p.altitude, heading: p.heading, vSpeed: p.vSpeedDamped };

  const circles = detectCircles(columns, CIRCLE[aircraft]);
  const thermals = detectThermals(columns, circles, CIRCLE[aircraft]);
  const glides = detectGlides(columns, thermals, flightRange(p.t, p.groundSpeed));
  const wind = estimateWind(columns, circles, thermals, WIND[aircraft]);

  const segments: ThermalSegment[] = thermals.map((thermal, k) => ({
    ...thermal,
    entryLat: p.lat[thermal.startIndex] ?? Number.NaN,
    entryLon: p.lon[thermal.startIndex] ?? Number.NaN,
    exitLat: p.lat[thermal.endIndex] ?? Number.NaN,
    exitLon: p.lon[thermal.endIndex] ?? Number.NaN,
    drift: wind.thermals[k]?.drift ?? null,
  }));

  // Средний набор — по времени: минута в сильном термике весит больше пузыря.
  const thermalTimeS = thermals.reduce((sum, t) => sum + t.durationS, 0);
  const avgClimbMs = thermalTimeS > 0 ? thermals.reduce((sum, t) => sum + t.gainM, 0) / thermalTimeS : null;
  // Среднее качество — по пути: длинный переход весит больше короткого.
  const real = glides.filter((g) => g.kind === 'glide');
  const lossM = real.reduce((sum, g) => sum + g.altLossM, 0);
  const avgGlideRatio = lossM > 0 ? Math.min(GLIDE.maxGlideRatio, real.reduce((sum, g) => sum + g.distanceM, 0) / lossM) : null;

  return { thermals: segments, glides, avgClimbMs, avgGlideRatio, wind: wind.flight, windProfile: wind.profile };
}
