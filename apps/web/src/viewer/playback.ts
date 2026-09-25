/**
 * Время трека: перевод между временем часов и индексом точки (ТЗ §7.5).
 * Часы Cesium — единственный источник правды, поэтому эти функции чистые
 * и не знают ни про Cesium, ни про DOM.
 */

export interface TrackTimeline {
  /** UNIX мс первой и последней точки. */
  startMs: number;
  endMs: number;
  /** Число точек сетки 1 Гц. */
  pointCount: number;
}

export const MS_PER_SECOND = 1000;

export function timelineOf(t: Float64Array): TrackTimeline {
  return {
    startMs: t[0] ?? Number.NaN,
    endMs: t[t.length - 1] ?? Number.NaN,
    pointCount: t.length,
  };
}

/** Длительность полёта, с. */
export const durationSeconds = (timeline: TrackTimeline): number =>
  (timeline.endMs - timeline.startMs) / MS_PER_SECOND;

/** Индекс точки по времени; за границами — крайняя точка. */
export function indexAt(t: Float64Array, timeMs: number): number {
  if (t.length === 0) return 0;
  const start = t[0] ?? 0;
  const seconds = (timeMs - start) / MS_PER_SECOND;
  return Math.max(0, Math.min(t.length - 1, Math.round(seconds)));
}

/** Доля пройденного пути, 0…1 — для скраббера и курсора графика. */
export function fractionAt(timeline: TrackTimeline, timeMs: number): number {
  const span = timeline.endMs - timeline.startMs;
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(1, (timeMs - timeline.startMs) / span));
}

/** Время по доле скраббера. */
export function timeAtFraction(timeline: TrackTimeline, fraction: number): number {
  const clamped = Math.max(0, Math.min(1, fraction));
  return timeline.startMs + (timeline.endMs - timeline.startMs) * clamped;
}

/** Время со сдвигом на секунды, зажатое в границы трека. */
export function seekBy(timeline: TrackTimeline, timeMs: number, deltaSeconds: number): number {
  const next = timeMs + deltaSeconds * MS_PER_SECOND;
  return Math.max(timeline.startMs, Math.min(timeline.endMs, next));
}

/** ТЗ §7.5: скорости проигрывания. */
export const PLAYBACK_SPEEDS = [1, 2, 4, 8, 16, 60] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 4;

/** Следующая скорость по кругу — одна кнопка вместо ряда на узком экране. */
export function nextSpeed(speed: PlaybackSpeed): PlaybackSpeed {
  const index = PLAYBACK_SPEEDS.indexOf(speed);
  return PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length] ?? DEFAULT_PLAYBACK_SPEED;
}

/** Часы:минуты:секунды от начала полёта — моноширинная телеметрия (§8.4). */
export function elapsedClock(timeline: TrackTimeline, timeMs: number): string {
  const total = Math.max(0, Math.round((timeMs - timeline.startMs) / MS_PER_SECOND));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}
