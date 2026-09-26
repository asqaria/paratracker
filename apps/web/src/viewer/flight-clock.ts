import {
  Cartesian3,
  ClockRange,
  JulianDate,
  LagrangePolynomialApproximation,
  SampledPositionProperty,
  type Clock,
  type Viewer,
} from 'cesium';

import type { DecodedTrack } from './decode-track';
import { DEFAULT_PLAYBACK_SPEED, timelineOf, type TrackTimeline } from './playback';

/**
 * Часы Cesium — единственный источник времени для всей страницы (ТЗ §7.5).
 * Позиция пилота — SampledPositionProperty с интерполяцией Лагранжа степени 2:
 * именно она даёт гладкое движение между фиксами, а не рывки (ТЗ §7.4).
 */

/** Степень интерполяции из ТЗ §7.4 — подобрана на прототипе. */
const INTERPOLATION_DEGREE = 2;

export interface FlightClock {
  timeline: TrackTimeline;
  position: SampledPositionProperty;
  /** Текущее время часов в UNIX мс. */
  currentTimeMs(): number;
  setTimeMs(timeMs: number): void;
}

const toJulian = (timeMs: number): JulianDate => JulianDate.fromDate(new Date(timeMs));

export function setupFlightClock(viewer: Viewer, track: DecodedTrack): FlightClock {
  const timeline = timelineOf(track.t);

  const position = new SampledPositionProperty();
  position.setInterpolationOptions({
    interpolationDegree: INTERPOLATION_DEGREE,
    interpolationAlgorithm: LagrangePolynomialApproximation,
  });
  for (let i = 0; i < track.pointCount; i++) {
    const lat = track.lat[i] ?? Number.NaN;
    const lon = track.lon[i] ?? Number.NaN;
    const alt = track.alt[i] ?? Number.NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(alt)) continue;
    position.addSample(toJulian(track.t[i] ?? Number.NaN), Cartesian3.fromDegrees(lon, lat, alt));
  }

  const clock: Clock = viewer.clock;
  clock.startTime = toJulian(timeline.startMs);
  clock.stopTime = toJulian(timeline.endMs);
  clock.currentTime = toJulian(timeline.startMs);
  // Полёт не крутится по кругу: доиграл — стоп на посадке.
  clock.clockRange = ClockRange.CLAMPED;
  clock.multiplier = DEFAULT_PLAYBACK_SPEED;
  clock.shouldAnimate = false;

  return {
    timeline,
    position,
    currentTimeMs: () => JulianDate.toDate(viewer.clock.currentTime).getTime(),
    setTimeMs: (timeMs) => {
      viewer.clock.currentTime = toJulian(timeMs);
    },
  };
}
