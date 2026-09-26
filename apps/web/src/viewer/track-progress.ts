/**
 * «Пройденный путь» (переключатель «Весь / Пройденный»). Трек остаётся одним
 * примитивом с вершинными цветами (ТЗ §7.3), но нарезан на куски — по
 * геометрическому инстансу на кусок, у каждого свой флаг показа. Показаны
 * куски, пройденные целиком; от начала текущего куска до пилота — короткий
 * хвост, отдельный маленький примитив. Так линия растёт плавно, а за кадр
 * меняются флаги двух-трёх кусков, а не геометрия на десятки тысяч точек.
 */

/** Что рисовать: весь трек или только путь до пилота. */
export const TRACK_SHOWN = ['all', 'flown'] as const;
export type TrackShown = (typeof TRACK_SHOWN)[number];
export const DEFAULT_TRACK_SHOWN: TrackShown = 'all';

/**
 * Вершин в куске. Мельче — больше инстансов (на 30 тыс. точек при 32 — около
 * тысячи, это ещё один батч); крупнее — длиннее хвост, который перестраивается
 * на каждой новой точке, и дольше тень (у неё хвоста нет) отстаёт от пилота.
 */
export const TRACK_CHUNK_POINTS = 32;

/**
 * Телефон: те же пороги, что у варианта compact в index.css — там ширина
 * < 640 или высота < 500 (проверяется тестом). Здесь это нужно не для вёрстки,
 * а для толщины линии: её задаёт геометрия Cesium, а не CSS.
 */
export const COMPACT_MEDIA_QUERY = '(max-width: 639px), (max-height: 499px)';

/**
 * Толщина линии трека и тени, px. ТЗ §7.2: 3–5 px на десктопе. На телефоне
 * 4 px на экране шириной 390 px — полоса поперёк долины: там 2 px.
 */
export function trackWidths(compact: boolean): { linePx: number; shadowPx: number } {
  return compact ? { linePx: 2, shadowPx: 1.5 } : { linePx: 4, shadowPx: 2 };
}

/** Куски [первая, последняя] вершина включительно; соседние делят вершину на стыке. */
export function chunkRanges(vertexCount: number, chunkPoints: number = TRACK_CHUNK_POINTS): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < vertexCount - 1; start += chunkPoints) {
    ranges.push([start, Math.min(start + chunkPoints, vertexCount - 1)]);
  }
  return ranges;
}

/**
 * Сколько вершин линии пройдено к точке трека pointIndex. sourceIndex —
 * индекс точки трека для каждой вершины (точки без координат в линию не
 * попадают, поэтому номера расходятся).
 */
export function flownVertexCount(sourceIndex: Int32Array, pointIndex: number): number {
  let lo = 0;
  let hi = sourceIndex.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sourceIndex[mid] ?? Number.POSITIVE_INFINITY) <= pointIndex) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface TrackProgress {
  /** Сколько первых кусков показать целиком. */
  fullChunks: number;
  /** Хвост [первая, последняя] вершина или null — хвоста нет. */
  tail: [number, number] | null;
}

/** Что показать, когда пройдено flown первых вершин. */
export function progressOf(ranges: ReadonlyArray<readonly [number, number]>, flown: number): TrackProgress {
  const last = flown - 1;
  let fullChunks = 0;
  while (fullChunks < ranges.length && (ranges[fullChunks]?.[1] ?? Number.POSITIVE_INFINITY) <= last) fullChunks += 1;
  const start = ranges[fullChunks]?.[0];
  return { fullChunks, tail: start !== undefined && last > start ? [start, last] : null };
}

/**
 * Доля длины куска, пройденная к моменту timeMs: отрезки до вершины last
 * целиком плюс доля отрезка last → last + 1 по времени. lengths — длины
 * отрезков куска, lengths[j] — от вершины start + j к следующей; times —
 * время каждой вершины линии. Тень обрезается по этой доле в каждом кадре:
 * координата s прижатой линии идёт по длине, а не по номеру вершины.
 */
export function chunkShare(
  lengths: readonly number[],
  times: ArrayLike<number>,
  start: number,
  last: number,
  timeMs: number,
): number {
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!(total > 0) || last < start) return 0;
  const k = last - start;
  let done = 0;
  for (let j = 0; j < k && j < lengths.length; j++) done += lengths[j] ?? 0;
  if (k >= lengths.length) return 1;
  const from = times[last] ?? 0;
  const to = times[last + 1] ?? from;
  const fraction = to > from ? Math.min(1, Math.max(0, (timeMs - from) / (to - from))) : 1;
  return Math.min(1, (done + (lengths[k] ?? 0) * fraction) / total);
}
