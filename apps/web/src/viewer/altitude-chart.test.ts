import { describe, expect, it } from 'vitest';

import { buildChartGeometry, buildSeriesGeometry, channelSeries, chartStep } from './altitude-chart';
import { varioCss } from './vario-palette';

const SIZE = { width: 1000, height: 100 };
const input = (alt: number[], vSpeed: number[]) => ({
  alt: Float64Array.from(alt),
  vSpeed: Float64Array.from(vSpeed),
});

describe('chartStep', () => {
  it('один сегмент на пиксель ширины', () => {
    expect(chartStep(15_000, 1000)).toBe(15);
    expect(chartStep(500, 1000)).toBe(1);
    expect(chartStep(1, 1000)).toBe(1);
    expect(chartStep(100, 0)).toBe(1);
  });
});

describe('buildChartGeometry', () => {
  it('высокая точка выше низкой, обе внутри полотна', () => {
    const geometry = buildChartGeometry(input([1000, 2000, 1500], [0, 0, 0]), SIZE);
    const [low, high, mid] = geometry.segments.length > 0 ? [0, 1, 2].map((i) => geometry.fill[i + 1]) : [];

    expect(geometry).toMatchObject({ minAlt: 1000, maxAlt: 2000 });
    expect(high?.y).toBeLessThan(low?.y ?? 0);
    expect(mid?.y).toBeGreaterThan(high?.y ?? 0);
    for (const point of geometry.fill) {
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(SIZE.height);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(SIZE.width);
    }
  });

  it('заливка начинается и заканчивается на нижней кромке', () => {
    const geometry = buildChartGeometry(input([1000, 1100], [0, 0]), SIZE);
    expect(geometry.fill.at(0)).toEqual({ x: 0, y: SIZE.height });
    expect(geometry.fill.at(-1)).toEqual({ x: SIZE.width, y: SIZE.height });
  });

  it('цвет сегмента — по вариометру его начала', () => {
    const geometry = buildChartGeometry(input([1000, 1100, 1200], [3, -3, 0]), SIZE);
    expect(geometry.segments[0]?.color).toBe(varioCss(3));
    expect(geometry.segments[1]?.color).toBe(varioCss(-3));
  });

  it('плоский профиль — линия по середине, без делений на ноль', () => {
    const geometry = buildChartGeometry(input([2000, 2000, 2000], [0, 0, 0]), SIZE);
    expect(geometry.minAlt).toBe(geometry.maxAlt);
    for (const segment of geometry.segments) {
      expect(Number.isFinite(segment.y1)).toBe(true);
      expect(Number.isFinite(segment.y2)).toBe(true);
    }
  });

  it('NaN высоты не ломает диапазон', () => {
    const geometry = buildChartGeometry(input([1000, Number.NaN, 3000], [0, 0, 0]), SIZE);
    expect(geometry).toMatchObject({ minAlt: 1000, maxAlt: 3000 });
  });

  it('пустой трек — пустая геометрия', () => {
    const geometry = buildChartGeometry(input([], []), SIZE);
    expect(geometry.fill).toEqual([]);
    expect(geometry.segments).toEqual([]);
  });
});

describe('каналы графика (задача 2.15)', () => {
  const track = {
    alt: Float64Array.from([1000, 1500, 1200]),
    vSpeed: Float64Array.from([2, -3, 1]),
    gSpeed: Float64Array.from([8, 12, 10]),
  };

  it('варио — шкала вокруг нуля, без заливки, линия нуля посередине', () => {
    const series = channelSeries('vario', track, null);
    if (!series) throw new Error('vario series expected');
    const geometry = buildSeriesGeometry(series, SIZE);
    expect(geometry).toMatchObject({ minAlt: -3, maxAlt: 3, fill: [] });
    expect(geometry.zeroY).toBeCloseTo((SIZE.height - 8 - 6) / 2 + 8, 9);
  });

  it('скорость — от нуля, один цвет (акцент)', () => {
    const series = channelSeries('speed', track, null);
    if (!series) throw new Error('speed series expected');
    const geometry = buildSeriesGeometry(series, SIZE);
    expect(geometry).toMatchObject({ minAlt: 0, maxAlt: 12 });
    expect(geometry.segments.every((s) => s.color === null)).toBe(true);
  });

  it('над рельефом: без рельефа канала нет; пустые места — без сегментов', () => {
    expect(channelSeries('agl', track, null)).toBeNull();
    const agl = Float64Array.from([Number.NaN, 300, 150]);
    const series = channelSeries('agl', track, agl);
    if (!series) throw new Error('agl series expected');
    const geometry = buildSeriesGeometry(series, SIZE);
    expect(geometry.minAlt).toBe(0);
    expect(geometry.segments).toHaveLength(1);
  });

  it('высота — прежний график: шкала по данным, ноль вне шкалы', () => {
    const series = channelSeries('altitude', track, null);
    if (!series) throw new Error('altitude series expected');
    expect(buildSeriesGeometry(series, SIZE)).toEqual(buildChartGeometry({ alt: track.alt, vSpeed: track.vSpeed }, SIZE));
    expect(buildSeriesGeometry(series, SIZE).zeroY).toBeNull();
  });
});

describe('выборка на пиксель', () => {
  it('среднее по корзине, а не случайная точка: частокол скорости сглаживается', () => {
    // 4000 точек на 1000 px: по 4 на пиксель, значения 0, 20, 0, 20 — среднее 10.
    const values = Float64Array.from({ length: 4000 }, (_, i) => (i % 2) * 20);
    const geometry = buildSeriesGeometry(
      { values, vSpeed: new Float64Array(4000), color: 'plain', scale: 'fromZero', fill: false },
      SIZE,
    );
    const ys = new Set(geometry.segments.slice(0, -1).map((s) => s.y1.toFixed(6)));
    expect(ys.size).toBe(1);
  });
});
