import { TIME, TRACK_FLAGS, type TrackColumns } from '@skyline/core';

import { breakAfterGap, forEachSegment } from './grid.js';

export interface ResampleOptions {
  intervalS: number;
  /** Пропуск дольше — разрыв: интерполяция через него запрещена (ТЗ §5.2). */
  maxGapS: number;
}

export interface ResampledTrack {
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  altBaro: Float64Array;
  altGnss: Float64Array;
  /** Биты TRACK_FLAGS: gap — края разрывов, fix2d — в интерполяции участвовал 2D-фикс. */
  flags: Uint8Array;
  gapCount: number;
}

const HALF_TURN_DEG = 180;
const FULL_TURN_DEG = 360;

const lerp = (a: number, b: number, w: number): number => (w === 0 ? a : a + (b - a) * w);

/** Долгота коротким путём через антимеридиан, результат в (−180, 180]. */
function lerpLongitude(a: number, b: number, w: number): number {
  let delta = b - a;
  if (delta > HALF_TURN_DEG) delta -= FULL_TURN_DEG;
  else if (delta < -HALF_TURN_DEG) delta += FULL_TURN_DEG;
  let value = lerp(a, a + delta, w);
  if (value > HALF_TURN_DEG) value -= FULL_TURN_DEG;
  else if (value <= -HALF_TURN_DEG) value += FULL_TURN_DEG;
  return value;
}

/**
 * Высота на сетке по фиксам сегмента, у которых она пригодна: 3D-фикс и значение есть
 * (ТЗ §3.3 — 2D-фиксы в вертикаль не идут). Между пригодными фиксами дальше maxGap — NaN;
 * до первого и после последнего — ближайшее значение, если оно не дальше maxGap.
 */
function altitudeChannel(
  points: TrackColumns,
  values: Float64Array,
  start: number,
  end: number,
  maxGapMs: number,
): (time: number) => number {
  const { t, valid } = points;
  const usable: number[] = [];
  for (let i = start; i <= end; i++) {
    if (valid[i] === 1 && !Number.isNaN(values[i] ?? Number.NaN)) usable.push(i);
  }
  let k = 0;

  return (time) => {
    if (usable.length === 0) return Number.NaN;
    while (k < usable.length - 1 && (t[usable[k + 1] ?? 0] ?? Infinity) <= time) k++;

    const a = usable[k] ?? 0;
    const ta = t[a] ?? Number.NaN;
    const va = values[a] ?? Number.NaN;
    const b = usable[k + 1];

    if (time <= ta || b === undefined) return Math.abs(ta - time) <= maxGapMs ? va : Number.NaN;
    const tb = t[b] ?? Number.NaN;
    if (tb - ta > maxGapMs) return Number.NaN;
    return lerp(va, values[b] ?? Number.NaN, (time - ta) / (tb - ta));
  };
}

/**
 * ТЗ §5.2 шаг 3: равномерная сетка intervalS линейной интерполяцией.
 * Узлы — кратные intervalS моменты внутри каждого сегмента; через разрыв узлов нет,
 * точки по краям разрыва помечены TRACK_FLAGS.gap.
 */
export function resample(points: TrackColumns, options: ResampleOptions): ResampledTrack {
  const stepMs = options.intervalS * TIME.msPerSecond;
  const maxGapMs = options.maxGapS * TIME.msPerSecond;
  const { t } = points;

  const segments: { start: number; end: number; first: number; count: number }[] = [];
  let total = 0;
  forEachSegment(t, breakAfterGap(options.maxGapS), (start, end) => {
    const first = Math.ceil((t[start] ?? 0) / stepMs) * stepMs;
    const last = t[end] ?? 0;
    const count = first > last ? 0 : Math.floor((last - first) / stepMs) + 1;
    segments.push({ start, end, first, count });
    total += count;
  });

  const out: ResampledTrack = {
    t: new Float64Array(total),
    lat: new Float64Array(total),
    lon: new Float64Array(total),
    altBaro: new Float64Array(total),
    altGnss: new Float64Array(total),
    flags: new Uint8Array(total),
    gapCount: 0,
  };

  let o = 0;
  for (const { start, end, first, count } of segments) {
    if (count === 0) continue;
    if (o > 0) {
      out.flags[o - 1] = (out.flags[o - 1] ?? 0) | TRACK_FLAGS.gap;
      out.flags[o] = (out.flags[o] ?? 0) | TRACK_FLAGS.gap;
      out.gapCount += 1;
    }

    const baro = altitudeChannel(points, points.altBaro, start, end, maxGapMs);
    const gnss = altitudeChannel(points, points.altGnss, start, end, maxGapMs);
    let j = start;

    for (let g = 0; g < count; g++) {
      const time = first + g * stepMs;
      while (j < end && (t[j + 1] ?? Infinity) <= time) j++;
      const next = j < end ? j + 1 : j;
      const tj = t[j] ?? 0;
      const w = next === j ? 0 : (time - tj) / ((t[next] ?? 0) - tj);

      out.t[o] = time;
      out.lat[o] = lerp(points.lat[j] ?? Number.NaN, points.lat[next] ?? Number.NaN, w);
      out.lon[o] = lerpLongitude(points.lon[j] ?? Number.NaN, points.lon[next] ?? Number.NaN, w);
      out.altBaro[o] = baro(time);
      out.altGnss[o] = gnss(time);
      if (points.valid[j] === 0 || (w > 0 && points.valid[next] === 0)) {
        out.flags[o] = (out.flags[o] ?? 0) | TRACK_FLAGS.fix2d;
      }
      o += 1;
    }
  }

  return out;
}
