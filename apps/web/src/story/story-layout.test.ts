import { describe, expect, it } from 'vitest';

import { altitudeChart, mapLayout, project, sampleIndices, smoothedVario, STORY, toCanvas } from './story-layout';

const BOX = STORY.fullTrackBox;
const lat = [43.1, 43.3, 43.15, 43.1];
const lon = [76.9, 77.0, 77.2, 76.9];

describe('mapLayout — трек в рамке картинки', () => {
  const layout = mapLayout(lat, lon, BOX);

  it('все точки — внутри рамки, центр трека — в центре рамки', () => {
    if (!layout) throw new Error('layout expected');
    const pts = lat.map((la, i) => toCanvas(layout, la, lon[i] ?? 0));
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(BOX.left - 1e-6);
      expect(p.x).toBeLessThanOrEqual(BOX.right + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(BOX.top - 1e-6);
      expect(p.y).toBeLessThanOrEqual(BOX.bottom + 1e-6);
    }
    const xs = pts.map((p) => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo((BOX.left + BOX.right) / 2, 6);
  });

  it('трек упирается в рамку по ширине или высоте — растяжение до края', () => {
    if (!layout) throw new Error('layout expected');
    const pts = lat.map((la, i) => toCanvas(layout, la, lon[i] ?? 0));
    const w = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const h = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    expect(Math.max(w / (BOX.right - BOX.left), h / (BOX.bottom - BOX.top))).toBeCloseTo(1, 6);
    expect(layout.scale).toBeGreaterThanOrEqual(1);
    expect(layout.scale).toBeLessThan(2);
  });

  it('уровень тайлов — самый крупный: на уровень крупнее трек бы не влез', () => {
    if (!layout) throw new Error('layout expected');
    const next = lat.map((la, i) => project(la, lon[i] ?? 0, layout.zoom + 1));
    const w = Math.max(...next.map((p) => p.x)) - Math.min(...next.map((p) => p.x));
    const h = Math.max(...next.map((p) => p.y)) - Math.min(...next.map((p) => p.y));
    expect(w > BOX.right - BOX.left || h > BOX.bottom - BOX.top).toBe(true);
  });

  it('тайлы накрывают картинку целиком', () => {
    if (!layout) throw new Error('layout expected');
    const minDx = Math.min(...layout.tiles.map((t) => t.dx));
    const minDy = Math.min(...layout.tiles.map((t) => t.dy));
    const maxDx = Math.max(...layout.tiles.map((t) => t.dx + t.size));
    const maxDy = Math.max(...layout.tiles.map((t) => t.dy + t.size));
    expect(minDx).toBeLessThanOrEqual(0);
    expect(minDy).toBeLessThanOrEqual(0);
    expect(maxDx).toBeGreaterThanOrEqual(STORY.width);
    expect(maxDy).toBeGreaterThanOrEqual(STORY.height);
  });

  it('точка — самый крупный масштаб; нет точек — null', () => {
    expect(mapLayout([43.1], [76.9], BOX)?.zoom).toBe(STORY.maxZoom);
    expect(mapLayout([Number.NaN], [Number.NaN], BOX)).toBeNull();
  });
});

describe('sampleIndices', () => {
  it('не больше max точек, концы на месте', () => {
    const idx = sampleIndices(10, 10_009, 2500);
    expect(idx.length).toBeLessThanOrEqual(2501);
    expect(idx[0]).toBe(10);
    expect(idx.at(-1)).toBe(10_009);
    expect(sampleIndices(5, 7, 100)).toEqual([5, 6, 7]);
  });
});

describe('altitudeChart', () => {
  it('столбец на пиксель; низ — минимум, верх — максимум', () => {
    const alt = Float64Array.from({ length: 1000 }, (_, i) => 1000 + i);
    const box = { left: 0, top: 0, right: 100, bottom: 50 };
    const pts = altitudeChart(alt, 0, 999, box);
    expect(pts).toHaveLength(100);
    expect(pts[0]?.y).toBeCloseTo(50, 6);
    expect(pts.at(-1)?.y).toBeCloseTo(0, 6);
  });

  it('без высоты — пусто', () => {
    expect(altitudeChart(new Float64Array(10).fill(Number.NaN), 0, 9, { left: 0, top: 0, right: 50, bottom: 10 })).toEqual([]);
  });
});

describe('smoothedVario', () => {
  it('шум ±1 м/с вокруг 2 м/с — ровно 2; шаг — varioStepMs', () => {
    const v = Float64Array.from({ length: 200 }, (_, i) => 2 + (i % 2 === 0 ? 1 : -1));
    const idx = sampleIndices(0, 199, 50);
    expect(new Set(smoothedVario(v, idx))).toEqual(new Set([2]));
    expect(smoothedVario(Float64Array.from([0.3, 0.3, 0.3]), [0, 1, 2])).toEqual([0.5, 0.5, 0.5]);
  });

  it('NaN пропускаются, без данных — 0', () => {
    expect(smoothedVario(Float64Array.from([Number.NaN, Number.NaN]), [0, 1])).toEqual([0, 0]);
  });
});
