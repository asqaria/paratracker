/**
 * Раскладка картинки-превью полёта для мессенджеров (задача 3.8): какой
 * масштаб Web Mercator, какие тайлы подложки и где на картинке точки трека.
 * Без сети и без рисования — только числа, чтобы проверять их тестом.
 */

export const PREVIEW = {
  /** Open Graph: 1.91:1, 1200×630 — размер, который Telegram, WhatsApp и X показывают крупно. */
  width: 1200,
  height: 630,
  /** Поля вокруг трека, px: линия не упирается в край карточки. */
  paddingPx: 70,
  tileSizePx: 256,
  /** Мельче не нужно: полёт в десятки км уже виден целиком. */
  minZoom: 3,
  /** World Imagery доходит до z18; для превью хватает z16 — короткий полёт не раскрывается до крыш. */
  maxZoom: 16,
} as const;

const MAX_LATITUDE = 85.05112878;
const HALF_TURN_DEG = 180;
const FULL_TURN_DEG = 360;

/** Пиксель Web Mercator на уровне zoom (EPSG:3857, как у тайлов Esri). */
export function project(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const size = PREVIEW.tileSizePx * 2 ** zoom;
  const phi = (Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat)) * Math.PI) / HALF_TURN_DEG;
  return {
    x: ((lon + HALF_TURN_DEG) / FULL_TURN_DEG) * size,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * size,
  };
}

export interface PreviewLayout {
  zoom: number;
  /** Тайлы подложки и их место на холсте тайлов (левый верхний — 0,0). */
  tiles: { z: number; x: number; y: number; left: number; top: number }[];
  /** Холст тайлов, px, и вырезаемое из него окно картинки. */
  canvas: { width: number; height: number };
  crop: { left: number; top: number };
  /** Точки трека в пикселях картинки. */
  points: { x: number; y: number }[];
}

/** null — точек нет. */
export function previewLayout(lat: readonly number[], lon: readonly number[]): PreviewLayout | null {
  if (lat.length === 0 || lat.length !== lon.length) return null;
  const fitW = PREVIEW.width - 2 * PREVIEW.paddingPx;
  const fitH = PREVIEW.height - 2 * PREVIEW.paddingPx;

  // Самый крупный масштаб, при котором трек влезает в поля.
  let zoom: number = PREVIEW.minZoom;
  for (let z = PREVIEW.maxZoom; z >= PREVIEW.minZoom; z--) {
    const px = lat.map((la, i) => project(la, lon[i] ?? 0, z));
    const w = Math.max(...px.map((p) => p.x)) - Math.min(...px.map((p) => p.x));
    const h = Math.max(...px.map((p) => p.y)) - Math.min(...px.map((p) => p.y));
    if (w <= fitW && h <= fitH) {
      zoom = z;
      break;
    }
  }

  const world = lat.map((la, i) => project(la, lon[i] ?? 0, zoom));
  const centerX = (Math.min(...world.map((p) => p.x)) + Math.max(...world.map((p) => p.x))) / 2;
  const centerY = (Math.min(...world.map((p) => p.y)) + Math.max(...world.map((p) => p.y))) / 2;
  const x0 = centerX - PREVIEW.width / 2;
  const y0 = centerY - PREVIEW.height / 2;

  const size = PREVIEW.tileSizePx;
  const tilesAcross = 2 ** zoom;
  const tx0 = Math.floor(x0 / size);
  const ty0 = Math.max(0, Math.floor(y0 / size));
  const tx1 = Math.floor((x0 + PREVIEW.width - 1) / size);
  const ty1 = Math.min(tilesAcross - 1, Math.floor((y0 + PREVIEW.height - 1) / size));

  const tiles: PreviewLayout['tiles'] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      // Через антимеридиан — тот же тайл с другой стороны мира.
      const wrapped = ((tx % tilesAcross) + tilesAcross) % tilesAcross;
      tiles.push({ z: zoom, x: wrapped, y: ty, left: (tx - tx0) * size, top: (ty - ty0) * size });
    }
  }

  return {
    zoom,
    tiles,
    canvas: { width: (tx1 - tx0 + 1) * size, height: (ty1 - ty0 + 1) * size },
    crop: { left: Math.round(x0 - tx0 * size), top: Math.round(y0 - ty0 * size) },
    points: world.map((p) => ({ x: p.x - x0, y: p.y - y0 })),
  };
}
