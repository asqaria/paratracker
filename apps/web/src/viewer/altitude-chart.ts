import { varioCss } from './vario-palette';

/**
 * Геометрия графика под сценой (ТЗ §7.5): высота — area chart, залитый
 * градиентом, плюс линия, раскрашенная по вариометру посегментно; каналы
 * «варио», «скорость», «над рельефом» (задача 2.15) — та же геометрия с
 * другой шкалой и цветом. Отдельный canvas, без Recharts и Chart.js — они
 * не держат 15 000 точек (CLAUDE.md).
 *
 * Здесь только расчёт координат: рисование — в компоненте, тест — на числах.
 */

export interface ChartSize {
  width: number;
  height: number;
}

export interface ChartInput {
  alt: Float64Array;
  vSpeed: Float64Array;
}

/**
 * fit — от минимума до максимума (высота); fromZero — от нуля (скорость,
 * высота над рельефом: ноль — земля); symmetric — вокруг нуля (варио:
 * набор и снижение одного масштаба).
 */
export type ChartScale = 'fit' | 'fromZero' | 'symmetric';

export interface SeriesInput {
  values: Float64Array;
  /** Для цвета линии по вариометру. */
  vSpeed: Float64Array;
  /** vario — цвет сегмента по вариометру; plain — один цвет (акцент). */
  color: 'vario' | 'plain';
  scale: ChartScale;
  fill: boolean;
}

export interface ChartSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Цвет по вариометру начала сегмента; null — цвет канала (акцент). */
  color: string | null;
}

export interface ChartGeometry {
  /** Точки заливки от левого нижнего угла и обратно; пусто — канал без заливки. */
  fill: { x: number; y: number }[];
  segments: ChartSegment[];
  /** Диапазон шкалы — для подписей оси. */
  minAlt: number;
  maxAlt: number;
  /** Высота линии нуля в пикселях; null — ноль вне шкалы (высота над морем). */
  zeroY: number | null;
}

/** Отступы, чтобы линия не липла к краям. */
const PADDING_TOP = 8;
const PADDING_BOTTOM = 6;

const finite = (values: Float64Array): number[] => Array.from(values).filter((value) => Number.isFinite(value));

/**
 * Один сегмент на пиксель ширины: на 15 000 точек и ширине 1200 px рисовать
 * каждую точку незачем, а шаг меньше пикселя не видно.
 */
export function chartStep(pointCount: number, width: number): number {
  if (pointCount <= 1 || width <= 0) return 1;
  return Math.max(1, Math.floor(pointCount / width));
}

function scaleRange(values: number[], scale: ChartScale): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 0 };
  // Не Math.min(...values): на 15 000 точек спред упирается в стек.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (scale === 'fromZero') return { min: Math.min(0, lo), max: hi };
  if (scale === 'symmetric') {
    const extent = Math.max(Math.abs(lo), Math.abs(hi));
    return { min: -extent, max: extent };
  }
  return { min: lo, max: hi };
}

/**
 * Среднее по корзине точек, попавших в один пиксель: выборка «каждая step-я
 * точка» на скорости и варио давала частокол — в термике путевая скорость
 * скачет по кругу (по ветру — против ветра), и одна точка на пиксель
 * попадала то в пик, то в провал. NaN не участвуют; вся корзина NaN — NaN.
 */
function bucketMeans(values: Float64Array, step: number): Float64Array {
  if (step <= 1) return values;
  const out = new Float64Array(values.length).fill(Number.NaN);
  for (let start = 0; start < values.length; start += step) {
    let sum = 0;
    let n = 0;
    for (let i = start; i < Math.min(start + step, values.length); i++) {
      const v = values[i] ?? Number.NaN;
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    out[start] = n > 0 ? sum / n : Number.NaN;
  }
  // Последняя точка — как есть: график кончается там же, где трек.
  out[values.length - 1] = values[values.length - 1] ?? Number.NaN;
  return out;
}

export function buildSeriesGeometry(rawInput: SeriesInput, size: ChartSize): ChartGeometry {
  const step = chartStep(rawInput.values.length, size.width);
  const input = { ...rawInput, values: bucketMeans(rawInput.values, step) };
  const count = input.values.length;
  const { min, max } = scaleRange(finite(input.values), input.scale);
  const span = max - min;

  const x = (index: number): number => (count <= 1 ? 0 : (index / (count - 1)) * size.width);
  const usable = size.height - PADDING_TOP - PADDING_BOTTOM;
  const y = (value: number): number => {
    if (!Number.isFinite(value) || span <= 0) return size.height - PADDING_BOTTOM - usable / 2;
    return size.height - PADDING_BOTTOM - ((value - min) / span) * usable;
  };

  const fill: { x: number; y: number }[] = [];
  const segments: ChartSegment[] = [];

  if (count > 0) {
    if (input.fill) {
      fill.push({ x: 0, y: size.height });
      for (let i = 0; i < count; i += step) fill.push({ x: x(i), y: y(input.values[i] ?? Number.NaN) });
      fill.push({ x: size.width, y: y(input.values[count - 1] ?? Number.NaN) });
      fill.push({ x: size.width, y: size.height });
    }

    for (let i = 0; i + step < count; i += step) {
      const a = input.values[i] ?? Number.NaN;
      const b = input.values[i + step] ?? Number.NaN;
      // Нет значения (над рельефом — вне полёта) — нет и сегмента.
      if (input.scale !== 'fit' && (!Number.isFinite(a) || !Number.isFinite(b))) continue;
      segments.push({
        x1: x(i),
        y1: y(a),
        x2: x(i + step),
        y2: y(b),
        color: input.color === 'vario' ? varioCss(input.vSpeed[i] ?? Number.NaN) : null,
      });
    }
  }

  const zeroY = span > 0 && min <= 0 && max >= 0 ? y(0) : null;
  return { fill, segments, minAlt: min, maxAlt: max, zeroY };
}

/** График высоты: заливка и линия по вариометру (ТЗ §7.5). */
export const buildChartGeometry = (input: ChartInput, size: ChartSize): ChartGeometry =>
  buildSeriesGeometry({ values: input.alt, vSpeed: input.vSpeed, color: 'vario', scale: 'fit', fill: true }, size);

/** Каналы графика (задача 2.15). */
export const CHART_CHANNELS = ['altitude', 'vario', 'speed', 'agl'] as const;
export type ChartChannel = (typeof CHART_CHANNELS)[number];

/** Данные канала; null — канала пока нет (рельеф под треком не пришёл). */
export function channelSeries(
  channel: ChartChannel,
  track: { alt: Float64Array; vSpeed: Float64Array; gSpeed: Float64Array },
  agl: Float64Array | null,
): SeriesInput | null {
  switch (channel) {
    case 'altitude':
      return { values: track.alt, vSpeed: track.vSpeed, color: 'vario', scale: 'fit', fill: true };
    case 'vario':
      return { values: track.vSpeed, vSpeed: track.vSpeed, color: 'vario', scale: 'symmetric', fill: false };
    case 'speed':
      return { values: track.gSpeed, vSpeed: track.vSpeed, color: 'plain', scale: 'fromZero', fill: true };
    case 'agl':
      return agl ? { values: agl, vSpeed: track.vSpeed, color: 'vario', scale: 'fromZero', fill: true } : null;
  }
}
