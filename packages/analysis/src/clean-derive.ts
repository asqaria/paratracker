import { CLEAN, MOTION, VARIO, type DerivedTrack, type ParsedTrack } from '@skyline/core';

import { medianFilterCoordinates } from './median-filter.js';
import { computeMotion } from './motion.js';
import { dropLowQualityFixes } from './quality-filter.js';
import { resample } from './resample.js';
import { analysisLevelFor, medianFixIntervalS } from './sampling.js';
import { savitzkyGolay } from './savitzky-golay.js';
import { verticalSpeed } from './vertical-speed.js';

/**
 * ТЗ §5.2, шаги 3–4: CLEAN + DERIVE. Чистая функция: вход не меняется, результат
 * детерминирован. altAgl здесь не считается — это отдельный шаг воркера (4b).
 */
export function cleanAndDerive(track: ParsedTrack): DerivedTrack {
  const medianInterval = medianFixIntervalS(track.points.t);
  const analysisLevel = analysisLevelFor(medianInterval);

  // Сначала отбрасываем фиксы с плохой точностью: иначе такой выброс успеет испортить медиану соседей.
  const quality = dropLowQualityFixes(track.points, {
    maxAccuracyM: CLEAN.maxFixAccuracyM,
    minSatellites: CLEAN.minSatellites,
  });
  const filtered = medianFilterCoordinates(quality.points, {
    window: CLEAN.coordinateMedianWindow,
    maxGapS: CLEAN.maxInterpolationGapS,
  });
  const grid = resample(filtered, { intervalS: CLEAN.resampleIntervalS, maxGapS: CLEAN.maxInterpolationGapS });

  // ТЗ §6.1: вариометр — по баро; нет баро — по GNSS.
  const altitude = savitzkyGolay(track.altitudeSource === 'baro' ? grid.altBaro : grid.altGnss, grid.t, {
    window: CLEAN.altitudeSmoothingWindow,
    order: CLEAN.altitudeSmoothingOrder,
    intervalS: CLEAN.resampleIntervalS,
  });
  const vario = (windowS: number): Float64Array =>
    verticalSpeed(grid.t, altitude, { windowS, intervalS: CLEAN.resampleIntervalS });

  const motion = computeMotion(grid.t, grid.lat, grid.lon, {
    intervalS: CLEAN.resampleIntervalS,
    minMovementM: MOTION.minMovementForHeadingM,
    turnRate: analysisLevel === 'full',
  });

  return {
    points: {
      t: grid.t,
      lat: grid.lat,
      lon: grid.lon,
      altBaro: grid.altBaro,
      altGnss: grid.altGnss,
      altitude,
      vSpeedInstant: vario(VARIO.instantWindowS),
      vSpeedDamped: vario(VARIO.dampedWindowS),
      vSpeedIntegral: vario(VARIO.integralWindowS),
      groundSpeed: motion.groundSpeed,
      heading: motion.heading,
      turnRate: motion.turnRate,
      flags: grid.flags,
    },
    analysisLevel,
    altitudeSource: track.altitudeSource,
    medianFixIntervalS: medianInterval,
    droppedFixes: quality.dropped,
    gapCount: grid.gapCount,
  };
}
