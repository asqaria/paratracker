import { MS_PER_SECOND } from './playback';

/**
 * Сглаживание трека для отрисовки — без Cesium. Запись раз в секунду: круг
 * термика за 20 с рисовался ломаной из 20 прямых отрезков. Между соседними
 * точками — промежуточные на кривой Catmull-Rom (равномерной): она проходит
 * ровно через исходные точки, ничего не выдумывает и инвариантна к аффинным
 * преобразованиям, поэтому считать можно прямо в градусах. Линия, тень и
 * пилот идут по одной кривой. Данные трека (телеметрия, анализ) не меняются.
 */

export const SMOOTH = {
  /** Отрезков на секунду записи: 4 — вираж параплана (18°/с) идёт шагами по 4.5°, глазу — дуга. */
  subdivisions: 4,
  /** Шаг дольше — разрыв записи: через него не сглаживаем (кривая выдумала бы путь). */
  maxStepS: 1.5,
} as const;

export interface SmoothInput {
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  alt: Float64Array;
  vSpeed: Float64Array;
}

export interface SmoothTrack extends SmoothInput {
  /** Индекс исходной точки, с которой начинается отрезок вершины. */
  sourceIndex: Int32Array;
}

/** Catmull-Rom на отрезке p1 → p2 при u ∈ [0, 1]. */
const catmullRom = (p0: number, p1: number, p2: number, p3: number, u: number): number =>
  0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);

export function smoothTrack(track: SmoothInput): SmoothTrack {
  const n = track.t.length;
  const k = SMOOTH.subdivisions;
  const size = n === 0 ? 0 : (n - 1) * k + 1;
  const out: SmoothTrack = {
    t: new Float64Array(size),
    lat: new Float64Array(size),
    lon: new Float64Array(size),
    alt: new Float64Array(size),
    vSpeed: new Float64Array(size),
    sourceIndex: new Int32Array(size),
  };
  const maxStepMs = SMOOTH.maxStepS * MS_PER_SECOND;
  const linked = (a: number, b: number): boolean =>
    a >= 0 && b < n && (track.t[b] ?? Infinity) - (track.t[a] ?? -Infinity) <= maxStepMs;

  for (let i = 0; i < n; i++) {
    const at = i * k;
    out.t[at] = track.t[i] ?? Number.NaN;
    out.lat[at] = track.lat[i] ?? Number.NaN;
    out.lon[at] = track.lon[i] ?? Number.NaN;
    out.alt[at] = track.alt[i] ?? Number.NaN;
    out.vSpeed[at] = track.vSpeed[i] ?? Number.NaN;
    out.sourceIndex[at] = i;
    if (i === n - 1) break;

    // Соседи для касательных; нет соседа или за ним разрыв — повтор крайней точки.
    const smooth = linked(i, i + 1);
    const i0 = linked(i - 1, i) ? i - 1 : i;
    const i3 = linked(i + 1, i + 2) ? i + 2 : i + 1;
    for (let s = 1; s < k; s++) {
      const u = s / k;
      const j = at + s;
      const lerp = (column: Float64Array): number => (column[i] ?? 0) + ((column[i + 1] ?? 0) - (column[i] ?? 0)) * u;
      const curve = (column: Float64Array): number =>
        smooth ? catmullRom(column[i0] ?? 0, column[i] ?? 0, column[i + 1] ?? 0, column[i3] ?? 0, u) : lerp(column);
      out.t[j] = lerp(track.t);
      out.lat[j] = curve(track.lat);
      out.lon[j] = curve(track.lon);
      out.alt[j] = curve(track.alt);
      out.vSpeed[j] = lerp(track.vSpeed);
      out.sourceIndex[j] = i;
    }
  }
  return out;
}

/** Сколько вершин (по возрастанию времени) пройдено к моменту timeMs: время ≤ timeMs. */
export function flownByTime(times: Float64Array, timeMs: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] ?? Infinity) <= timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
