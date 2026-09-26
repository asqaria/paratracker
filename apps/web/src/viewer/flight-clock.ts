import {
  Cartesian3,
  ClockRange,
  ExtrapolationType,
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

export const toJulian = (timeMs: number): JulianDate => JulianDate.fromDate(new Date(timeMs));

/**
 * Позиция пилота по треку. hold — до первой точки и после последней пилот
 * стоит на краю трека, а не исчезает: в сравнении (задача 3.12) часы общие,
 * и один ещё на старте, когда другой уже сел.
 */
export function trackPosition(track: DecodedTrack, hold = false): SampledPositionProperty {
  const position = new SampledPositionProperty();
  if (hold) {
    position.backwardExtrapolationType = ExtrapolationType.HOLD;
    position.forwardExtrapolationType = ExtrapolationType.HOLD;
  }
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
  return position;
}

/** Часы Cesium на отрезок времени: стоп на краях, не играют до команды. */
export function setupSceneClock(viewer: Viewer, timeline: { startMs: number; endMs: number }): void {
  const clock: Clock = viewer.clock;
  clock.startTime = toJulian(timeline.startMs);
  clock.stopTime = toJulian(timeline.endMs);
  clock.currentTime = toJulian(timeline.startMs);
  // Полёт не крутится по кругу: доиграл — стоп на посадке.
  clock.clockRange = ClockRange.CLAMPED;
  clock.multiplier = DEFAULT_PLAYBACK_SPEED;
  clock.shouldAnimate = false;
}

export function setupFlightClock(viewer: Viewer, track: DecodedTrack): FlightClock {
  const timeline = timelineOf(track.t);
  const position = trackPosition(track);
  setupSceneClock(viewer, timeline);
  return {
    timeline,
    position,
    currentTimeMs: () => JulianDate.toDate(viewer.clock.currentTime).getTime(),
    setTimeMs: (timeMs) => {
      viewer.clock.currentTime = toJulian(timeMs);
    },
  };
}
