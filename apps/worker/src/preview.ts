import sharp from 'sharp';

import { PREVIEW, previewLayout } from './preview-layout.js';

/**
 * Картинка-превью полёта для мессенджеров (задача 3.8, ТЗ §3.8): спутниковая
 * подложка, трек, XC-маршрут, атрибуция подложки. Рисует libvips (sharp):
 * тайлы — склейкой, линии и подписи — SVG поверх. Не блокирует поток:
 * sharp работает в пуле libuv.
 *
 * Трек — для посторонних (без записи на земле, задача 3.7): превью видит кто угодно.
 */

/** Цвета — токены дизайн-системы (apps/web/src/index.css): превью в стиле сайта. */
const COLORS = {
  void: '#0a0e14',
  accent: '#4da3ff',
  primary: '#e8edf5',
} as const;

const STYLE = {
  /** Тёмная обводка под линией: трек читается и на снегу, и на лесе. */
  casingPx: 9,
  linePx: 5,
  /** Старт и финиш трека. */
  endpointRadiusPx: 9,
  /** XC-маршрут — пунктир поверх трека. */
  xcPx: 3,
  xcDash: '14 10',
  /** Полоса внизу: марка слева, атрибуция подложки справа. */
  bandPx: 34,
  fontPx: 15,
  brandFontPx: 20,
  jpegQuality: 82,
} as const;

export interface PreviewInput {
  lat: readonly number[];
  lon: readonly number[];
  /** Вершины XC-маршрута; треугольник замыкается. */
  xc?: { lat: number; lon: number }[] | null;
  xcClosed?: boolean;
}

/** Подложка: тайл z/x/y (null — не пришёл, место останется тёмным) и обязательная подпись. */
export interface TileSource {
  fetchTile(z: number, x: number, y: number): Promise<Uint8Array | null>;
  /** Дословно по лицензии провайдера (CLAUDE.md: без атрибуции подложка незаконна). */
  attribution: string;
}

const escapeXml = (text: string): string =>
  text.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch] ?? ch);

const pathOf = (points: readonly { x: number; y: number }[]): string =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');

/** JPEG 1200×630; null — точек нет, рисовать нечего. */
export async function renderPreview(input: PreviewInput, source: TileSource | null): Promise<Buffer | null> {
  const xc = input.xc ?? [];
  // Раскладка — по треку и маршруту вместе: вершины маршрута тоже в кадре.
  const layout = previewLayout([...input.lat, ...xc.map((p) => p.lat)], [...input.lon, ...xc.map((p) => p.lon)]);
  if (!layout) return null;
  const track = layout.points.slice(0, input.lat.length);
  const route = layout.points.slice(input.lat.length);
  if (input.xcClosed && route[0]) route.push(route[0]);

  const tiles = source
    ? await Promise.all(
        layout.tiles.map(async (tile) => {
          const bytes = await source.fetchTile(tile.z, tile.x, tile.y).catch(() => null);
          return bytes ? { input: Buffer.from(bytes), left: tile.left, top: tile.top } : null;
        }),
      )
    : [];
  const base = await sharp({
    create: { width: layout.canvas.width, height: layout.canvas.height, channels: 3, background: COLORS.void },
  })
    .composite(tiles.filter((t) => t !== null))
    .png()
    .toBuffer();

  const { width, height } = PREVIEW;
  const first = track[0];
  const last = track.at(-1);
  const attribution = source ? escapeXml(source.attribution) : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <path d="${pathOf(track)}" fill="none" stroke="${COLORS.void}" stroke-opacity="0.75" stroke-width="${STYLE.casingPx}" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${pathOf(track)}" fill="none" stroke="${COLORS.accent}" stroke-width="${STYLE.linePx}" stroke-linejoin="round" stroke-linecap="round"/>
  ${route.length > 1 ? `<path d="${pathOf(route)}" fill="none" stroke="${COLORS.primary}" stroke-width="${STYLE.xcPx}" stroke-dasharray="${STYLE.xcDash}"/>` : ''}
  ${first ? `<circle cx="${first.x.toFixed(1)}" cy="${first.y.toFixed(1)}" r="${STYLE.endpointRadiusPx}" fill="${COLORS.primary}" stroke="${COLORS.void}" stroke-width="3"/>` : ''}
  ${last ? `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="${STYLE.endpointRadiusPx}" fill="${COLORS.accent}" stroke="${COLORS.void}" stroke-width="3"/>` : ''}
  <rect x="0" y="${height - STYLE.bandPx}" width="${width}" height="${STYLE.bandPx}" fill="${COLORS.void}" fill-opacity="0.72"/>
  <text x="16" y="${height - 10}" font-family="DejaVu Sans, sans-serif" font-size="${STYLE.brandFontPx}" font-weight="bold" fill="${COLORS.primary}">Skyline</text>
  <text x="${width - 16}" y="${height - 11}" text-anchor="end" font-family="DejaVu Sans, sans-serif" font-size="${STYLE.fontPx}" fill="${COLORS.primary}">${attribution}</text>
</svg>`;

  return sharp(base)
    .extract({ left: layout.crop.left, top: layout.crop.top, width, height })
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .jpeg({ quality: STYLE.jpegQuality, mozjpeg: true })
    .toBuffer();
}
