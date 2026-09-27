/**
 * Раскладка картинки для сторис (задача 4.8): 1080×1920, Web Mercator как у
 * тайлов подложки. Чистая геометрия — рисует render-story.ts.
 */

export const STORY = {
  /** Instagram Stories / Reels — 9:16. */
  width: 1080,
  height: 1920,
  /** Размер тайла подложки, px. */
  tilePx: 256,
  /** Мельче — страна целиком; крупнее — у Esri над горами пусто. */
  minZoom: 3,
  maxZoom: 15,
  /** Рамка трека на полной картинке: сверху — заголовок, снизу — цифры. */
  fullTrackBox: { left: 90, top: 300, right: 990, bottom: 1180 },
  /** На прозрачной — середина кадра: сверху и снизу место под фото пилота. */
  overlayTrackBox: { left: 140, top: 520, right: 940, bottom: 1180 },
  /** Точек линии трека: больше — не видно глазом, меньше — ломаная в термиках. */
  maxTrackPoints: 2500,
  /** Сглаживание варио для цвета линии: ± столько соседних точек выборки. */
  varioSmoothPoints: 6,
  /** Шаг цвета, м/с: цвет меняется участками, а не на каждой точке — без штриховки. */
  varioStepMs: 0.5,
} as const;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const RADIANS_PER_DEGREE = Math.PI / 180;
/** Web Mercator обрезан на ±85.05° — там карта кончается. */
const MAX_LATITUDE = 85.051129;
/** Растяжение строго меньше двух: на ×2 уже взяли бы следующий уровень тайлов. */
const MAX_SCALE = 1.999;

/** Мировые пиксели Web Mercator на уровне zoom. */
export function project(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const size = STORY.tilePx * 2 ** zoom;
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const sin = Math.sin(clamped * RADIANS_PER_DEGREE);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export interface MapLayout {
  zoom: number;
  /**
   * Растяжение тайлов, [1, 2): уровни идут через ×2, без него трек занимал бы
   * от половины до всей рамки.
   */
  scale: number;
  /** Мировые пиксели (уровня zoom, умноженные на scale) левого верхнего угла. */
  originX: number;
  originY: number;
  /** Тайлы, накрывающие картинку целиком, где их рисовать и каким размером. */
  tiles: { z: number; x: number; y: number; dx: number; dy: number; size: number }[];
}

/**
 * Масштаб — самый крупный, при котором трек влезает в рамку: уровень тайлов
 * плюс растяжение до края рамки. Центр трека — в центре рамки. Точек нет — null.
 */
export function mapLayout(lat: ArrayLike<number>, lon: ArrayLike<number>, box: Box): MapLayout | null {
  const finite: number[] = [];
  for (let i = 0; i < lat.length; i++) {
    if (Number.isFinite(lat[i]) && Number.isFinite(lon[i])) finite.push(i);
  }
  if (finite.length === 0) return null;
  const extent = (zoom: number) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const i of finite) {
      const p = project(lat[i] ?? 0, lon[i] ?? 0, zoom);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, maxX, minY, maxY };
  };
  const boxW = box.right - box.left;
  const boxH = box.bottom - box.top;
  let zoom: number = STORY.minZoom;
  for (let z = STORY.maxZoom; z >= STORY.minZoom; z--) {
    const e = extent(z);
    if (e.maxX - e.minX <= boxW && e.maxY - e.minY <= boxH) {
      zoom = z;
      break;
    }
  }
  const e = extent(zoom);
  const w = e.maxX - e.minX;
  const h = e.maxY - e.minY;
  // Следующий уровень не влез — значит, растяжение меньше двух.
  const fit = Math.min(w > 0 ? boxW / w : Infinity, h > 0 ? boxH / h : Infinity);
  const scale = zoom === STORY.maxZoom || !Number.isFinite(fit) ? 1 : Math.max(1, Math.min(MAX_SCALE, fit));
  const size = STORY.tilePx * scale;
  const originX = ((e.minX + e.maxX) / 2) * scale - (box.left + box.right) / 2;
  const originY = ((e.minY + e.maxY) / 2) * scale - (box.top + box.bottom) / 2;
  const tiles: MapLayout['tiles'] = [];
  const count = 2 ** zoom;
  const firstX = Math.floor(originX / size);
  const firstY = Math.floor(originY / size);
  const lastX = Math.floor((originX + STORY.width - 1) / size);
  const lastY = Math.floor((originY + STORY.height - 1) / size);
  for (let ty = Math.max(0, firstY); ty <= Math.min(count - 1, lastY); ty++) {
    for (let tx = firstX; tx <= lastX; tx++) {
      tiles.push({
        z: zoom,
        // По долготе мир замкнут: тайл за краем — тот же с другой стороны.
        x: ((tx % count) + count) % count,
        y: ty,
        dx: tx * size - originX,
        dy: ty * size - originY,
        size,
      });
    }
  }
  return { zoom, scale, originX, originY, tiles };
}

/** Точка трека на картинке. */
export function toCanvas(layout: MapLayout, lat: number, lon: number): { x: number; y: number } {
  const p = project(lat, lon, layout.zoom);
  return { x: p.x * layout.scale - layout.originX, y: p.y * layout.scale - layout.originY };
}

/** Индексы точек полёта [from, to] с шагом, чтобы их было не больше max. */
export function sampleIndices(from: number, to: number, max: number): number[] {
  if (to < from) return [];
  const step = Math.max(1, Math.ceil((to - from + 1) / max));
  const out: number[] = [];
  for (let i = from; i <= to; i += step) out.push(i);
  if (out.at(-1) !== to) out.push(to);
  return out;
}

/**
 * График высоты в рамке: по столбцу пикселя — средняя высота точек в нём
 * (как в таймлайне, без «зубьев» от шума). NaN-высоты пропускаются.
 */
export function altitudeChart(alt: ArrayLike<number>, from: number, to: number, box: Box): { x: number; y: number }[] {
  const width = Math.round(box.right - box.left);
  if (to <= from || width <= 1) return [];
  const sums = new Float64Array(width);
  const counts = new Uint32Array(width);
  for (let i = from; i <= to; i++) {
    const a = alt[i] ?? Number.NaN;
    if (!Number.isFinite(a)) continue;
    const col = Math.min(width - 1, Math.floor(((i - from) / (to - from)) * width));
    sums[col] = (sums[col] ?? 0) + a;
    counts[col] = (counts[col] ?? 0) + 1;
  }
  let min = Infinity;
  let max = -Infinity;
  const means: (number | null)[] = [];
  for (let c = 0; c < width; c++) {
    const n = counts[c] ?? 0;
    const mean = n > 0 ? (sums[c] ?? 0) / n : null;
    means.push(mean);
    if (mean !== null) {
      min = Math.min(min, mean);
      max = Math.max(max, mean);
    }
  }
  if (!Number.isFinite(min)) return [];
  const span = max - min || 1;
  const points: { x: number; y: number }[] = [];
  means.forEach((mean, c) => {
    if (mean === null) return;
    points.push({ x: box.left + c, y: box.bottom - ((mean - min) / span) * (box.bottom - box.top) });
  });
  return points;
}

/**
 * Варио для цвета линии в точках выборки: среднее по сырым точкам вокруг
 * (± varioSmoothPoints шагов выборки), округлённое до varioStepMs.
 */
export function smoothedVario(vSpeed: ArrayLike<number>, indices: readonly number[]): number[] {
  const n = indices.length;
  const prefix = new Float64Array(vSpeed.length + 1);
  const counts = new Float64Array(vSpeed.length + 1);
  for (let i = 0; i < vSpeed.length; i++) {
    const v = vSpeed[i] ?? Number.NaN;
    const ok = Number.isFinite(v);
    prefix[i + 1] = (prefix[i] ?? 0) + (ok ? v : 0);
    counts[i + 1] = (counts[i] ?? 0) + (ok ? 1 : 0);
  }
  return indices.map((_, k) => {
    const from = indices[Math.max(0, k - STORY.varioSmoothPoints)] ?? 0;
    const to = (indices[Math.min(n - 1, k + STORY.varioSmoothPoints)] ?? 0) + 1;
    const count = (counts[to] ?? 0) - (counts[from] ?? 0);
    const mean = count > 0 ? ((prefix[to] ?? 0) - (prefix[from] ?? 0)) / count : 0;
    return Math.round(mean / STORY.varioStepMs) * STORY.varioStepMs;
  });
}
