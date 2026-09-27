import { documentColorTokens, withAlpha } from '../design/tokens';
import { varioCss } from '../viewer/vario-palette';
import { altitudeChart, mapLayout, sampleIndices, smoothedVario, STORY, toCanvas, type Box } from './story-layout';

/**
 * Картинка для сторис (задача 4.8): canvas 1080×1920 в браузере, без сервера.
 * «full» — спутник, трек, цифры, график; «overlay» — то же без фона, PNG с
 * прозрачностью: пилот кладёт его в Instagram поверх своего фото.
 */

export type StoryVariant = 'full' | 'overlay';

export interface StoryStat {
  label: string;
  value: string;
}

export interface StoryData {
  lat: ArrayLike<number>;
  lon: ArrayLike<number>;
  alt: ArrayLike<number>;
  vSpeed: ArrayLike<number>;
  /** Полёт в записи: [takeoff, landing] — без ходьбы по земле. */
  from: number;
  to: number;
  /** «23 июля 2023» и «Уш-Коныр» — сверху. */
  title: string;
  subtitle: string | null;
  /** До четырёх цифр в сетке 2×2. */
  stats: StoryStat[];
  /** Марка внизу (i18n app.name). */
  brand: string;
  /** Подпись подложки — обязательна, если она на картинке (ТЗ §4.4.1). */
  attribution: string | null;
}

/** Тайл подложки z/x/y; null — не пришёл, место останется тёмным. */
export type TileLoader = (z: number, x: number, y: number) => Promise<CanvasImageSource | null>;

const S = {
  titleY: 150,
  subtitleY: 225,
  titlePx: 58,
  subtitlePx: 40,
  statsTop: 1370,
  statsRowPx: 150,
  statLabelPx: 30,
  statValuePx: 76,
  statUnitPx: 38,
  statGapPx: 10,
  statsLeft: 90,
  statsColumnPx: 480,
  chart: { left: 90, top: 1690, right: 990, bottom: 1800 } satisfies Box,
  brandY: 1870,
  brandPx: 40,
  attributionPx: 20,
  /** Линия трека и её тёмная обводка, px. */
  trackPx: 9,
  casingPx: 15,
  chartLinePx: 4,
  shadowBlurPx: 18,
} as const;

/** Шрифты — те же, что у интерфейса: цифры берутся у утилиты numeric. */
function fonts() {
  const probe = document.createElement('span');
  probe.className = 'numeric';
  document.body.append(probe);
  const numeric = getComputedStyle(probe).fontFamily || 'monospace';
  probe.remove();
  const ui = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  return { ui, numeric };
}

async function drawMap(ctx: CanvasRenderingContext2D, data: StoryData, tiles: TileLoader | null, box: Box) {
  const indices = sampleIndices(data.from, data.to, STORY.maxTrackPoints);
  const lat = indices.map((i) => data.lat[i] ?? Number.NaN);
  const lon = indices.map((i) => data.lon[i] ?? Number.NaN);
  const layout = mapLayout(lat, lon, box);
  if (!layout) return null;
  if (tiles) {
    const images = await Promise.all(layout.tiles.map((t) => tiles(t.z, t.x, t.y).catch(() => null)));
    layout.tiles.forEach((t, k) => {
      const image = images[k];
      // +1 px: при дробном растяжении иначе между тайлами просвечивают швы.
      if (image) ctx.drawImage(image, t.dx, t.dy, t.size + 1, t.size + 1);
    });
  }
  return { layout, indices };
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number; vario: number }[],
  casing: string,
) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Обводка — одним путём: иначе на стыках сегментов видны бусины.
  ctx.beginPath();
  points.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = casing;
  ctx.lineWidth = S.casingPx;
  ctx.stroke();
  // Цвет — участками одного цвета (варио сглажено и округлено): отрезок на точку
  // дал бы бусины или штриховку.
  ctx.lineWidth = S.trackPx;
  let k = 1;
  while (k < points.length) {
    const color = varioCss(points[k]?.vario ?? 0);
    const start = points[k - 1];
    if (!start) break;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    while (k < points.length && varioCss(points[k]?.vario ?? 0) === color) {
      const p = points[k];
      if (p) ctx.lineTo(p.x, p.y);
      k++;
    }
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}

/** Цифры — крупно, единицы («ч», «мин», «км») — мельче и светлее: как на табло. */
function drawValue(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, numeric: string, unitColor: string, color: string) {
  let cursor = x;
  for (const part of value.split(/(\d[\d\s.,:  ]*)/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const digits = /^\d/.test(trimmed);
    ctx.font = digits ? `${S.statValuePx}px ${numeric}` : `500 ${S.statUnitPx}px ${numeric}`;
    ctx.fillStyle = digits ? color : unitColor;
    ctx.fillText(trimmed, cursor, y);
    cursor += ctx.measureText(trimmed).width + S.statGapPx;
  }
}

/** Картинка сторис: PNG (прозрачность у overlay). */
export async function renderStory(data: StoryData, variant: StoryVariant, tiles: TileLoader | null): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = STORY.width;
  canvas.height = STORY.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  const tokens = documentColorTokens();
  const { ui, numeric } = fonts();
  await Promise.all([document.fonts.load(`700 ${S.titlePx}px ${ui}`), document.fonts.load(`${S.statValuePx}px ${numeric}`)]);
  const full = variant === 'full';

  // Фон: у полной — тёмный, поверх — спутник; у прозрачной — ничего.
  if (full) {
    ctx.fillStyle = tokens.void;
    ctx.fillRect(0, 0, STORY.width, STORY.height);
  }
  const map = await drawMap(ctx, data, full ? tiles : null, full ? STORY.fullTrackBox : STORY.overlayTrackBox);

  if (full) {
    // Затемнения под текстом: сверху — заголовок, снизу — цифры поверх спутника.
    const top = ctx.createLinearGradient(0, 0, 0, 340);
    top.addColorStop(0, withAlpha(tokens.void, 0.85));
    top.addColorStop(1, withAlpha(tokens.void, 0));
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, STORY.width, 340);
    const bottom = ctx.createLinearGradient(0, 1080, 0, 1400);
    bottom.addColorStop(0, withAlpha(tokens.void, 0));
    bottom.addColorStop(1, tokens.void);
    ctx.fillStyle = bottom;
    ctx.fillRect(0, 1080, STORY.width, STORY.height - 1080);
  }

  if (map) {
    const vario = smoothedVario(data.vSpeed, map.indices);
    const points = map.indices
      .map((i, k) => ({ k, p: toCanvas(map.layout, data.lat[i] ?? Number.NaN, data.lon[i] ?? Number.NaN) }))
      .filter(({ p }) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map(({ k, p }) => ({ x: p.x, y: p.y, vario: vario[k] ?? 0 }));
    drawTrack(ctx, points, withAlpha(tokens.void, full ? 0.7 : 0.55));
  }

  // Текст на прозрачной — с тенью: читается и на снегу, и на небе.
  const shadow = (on: boolean) => {
    ctx.shadowColor = on ? withAlpha(tokens.void, 0.75) : 'transparent';
    ctx.shadowBlur = on ? S.shadowBlurPx : 0;
  };
  shadow(!full);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = tokens.primary;
  ctx.font = `700 ${S.titlePx}px ${ui}`;
  ctx.fillText(data.title, S.statsLeft, S.titleY);
  if (data.subtitle) {
    ctx.fillStyle = full ? tokens.secondary : tokens.primary;
    ctx.font = `500 ${S.subtitlePx}px ${ui}`;
    ctx.fillText(data.subtitle, S.statsLeft, S.subtitleY);
  }

  data.stats.slice(0, 4).forEach((stat, k) => {
    const x = S.statsLeft + (k % 2) * S.statsColumnPx;
    const y = S.statsTop + Math.floor(k / 2) * S.statsRowPx;
    ctx.fillStyle = full ? tokens.secondary : tokens.primary;
    ctx.font = `500 ${S.statLabelPx}px ${ui}`;
    ctx.fillText(stat.label, x, y);
    drawValue(ctx, stat.value, x, y + S.statValuePx + 8, numeric, full ? tokens.secondary : tokens.primary, tokens.primary);
  });

  const chart = altitudeChart(data.alt, data.from, data.to, S.chart);
  if (chart.length > 1) {
    if (full) {
      shadow(false);
      const fill = ctx.createLinearGradient(0, S.chart.top, 0, S.chart.bottom);
      fill.addColorStop(0, withAlpha(tokens.accent, 0.35));
      fill.addColorStop(1, withAlpha(tokens.accent, 0));
      ctx.beginPath();
      ctx.moveTo(chart[0]?.x ?? 0, S.chart.bottom);
      chart.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.lineTo(chart.at(-1)?.x ?? 0, S.chart.bottom);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    shadow(!full);
    ctx.beginPath();
    chart.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = full ? tokens.accent : tokens.primary;
    ctx.lineWidth = S.chartLinePx;
    ctx.stroke();
  }

  ctx.fillStyle = tokens.primary;
  ctx.font = `700 ${S.brandPx}px ${ui}`;
  ctx.fillText(data.brand, S.statsLeft, S.brandY);
  if (full && data.attribution) {
    shadow(false);
    ctx.fillStyle = tokens.secondary;
    ctx.font = `${S.attributionPx}px ${ui}`;
    ctx.textAlign = 'right';
    ctx.fillText(data.attribution, STORY.width - S.statsLeft, S.brandY);
    ctx.textAlign = 'left';
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))), 'image/png');
  });
}
