import { varioCss } from './vario-palette';

/**
 * Геометрия графика высоты (ТЗ §7.5): area chart, залитый градиентом, плюс
 * линия, раскрашенная по вариометру посегментно. Отдельный canvas, без Recharts
 * и Chart.js — они не держат 15 000 точек (CLAUDE.md).
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

export interface ChartSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Цвет по вариометру начала сегмента. */
  color: string;
}

export interface ChartGeometry {
  /** Точки заливки от левого нижнего угла и обратно. */
  fill: { x: number; y: number }[];
  segments: ChartSegment[];
  /** Диапазон высот, м — для подписей оси. */
  minAlt: number;
  maxAlt: number;
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

export function buildChartGeometry(input: ChartInput, size: ChartSize): ChartGeometry {
  const count = input.alt.length;
  const altitudes = finite(input.alt);
  const minAlt = altitudes.length > 0 ? Math.min(...altitudes) : 0;
  const maxAlt = altitudes.length > 0 ? Math.max(...altitudes) : 0;
  const span = maxAlt - minAlt;

  const x = (index: number): number => (count <= 1 ? 0 : (index / (count - 1)) * size.width);
  const y = (alt: number): number => {
    const usable = size.height - PADDING_TOP - PADDING_BOTTOM;
    if (!Number.isFinite(alt) || span <= 0) return size.height - PADDING_BOTTOM - usable / 2;
    return size.height - PADDING_BOTTOM - ((alt - minAlt) / span) * usable;
  };

  const step = chartStep(count, size.width);
  const fill: { x: number; y: number }[] = [];
  const segments: ChartSegment[] = [];

  if (count > 0) {
    fill.push({ x: 0, y: size.height });
    for (let i = 0; i < count; i += step) fill.push({ x: x(i), y: y(input.alt[i] ?? Number.NaN) });
    fill.push({ x: size.width, y: y(input.alt[count - 1] ?? Number.NaN) });
    fill.push({ x: size.width, y: size.height });

    for (let i = 0; i + step < count; i += step) {
      segments.push({
        x1: x(i),
        y1: y(input.alt[i] ?? Number.NaN),
        x2: x(i + step),
        y2: y(input.alt[i + step] ?? Number.NaN),
        color: varioCss(input.vSpeed[i] ?? Number.NaN),
      });
    }
  }

  return { fill, segments, minAlt, maxAlt };
}
