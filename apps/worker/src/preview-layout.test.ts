import { describe, expect, it } from 'vitest';

import { PREVIEW, previewLayout, project } from './preview-layout.js';

describe('project — Web Mercator', () => {
  it('0,0 — центр мира; север — вверх (меньше y)', () => {
    const size = PREVIEW.tileSizePx * 2 ** 2;
    expect(project(0, 0, 2)).toEqual({ x: size / 2, y: size / 2 });
    expect(project(43, 76.9, 10).y).toBeLessThan(project(42, 76.9, 10).y);
  });
});

describe('previewLayout', () => {
  // Треугольник ~30 км под Алматы.
  const lat = [43.1, 43.3, 43.15, 43.1];
  const lon = [76.9, 77.0, 77.2, 76.9];
  const layout = previewLayout(lat, lon);

  it('трек в полях картинки, по центру', () => {
    if (!layout) throw new Error('layout expected');
    const xs = layout.points.map((p) => p.x);
    const ys = layout.points.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(PREVIEW.paddingPx - 1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(PREVIEW.width - PREVIEW.paddingPx + 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(PREVIEW.paddingPx - 1);
    expect(Math.max(...ys)).toBeLessThanOrEqual(PREVIEW.height - PREVIEW.paddingPx + 1);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(PREVIEW.width / 2, 6);
  });

  it('масштаб — самый крупный, при котором трек ещё влезает', () => {
    if (!layout) throw new Error('layout expected');
    const bigger = previewLayout(lat, lon);
    expect(bigger?.zoom).toBe(layout.zoom);
    // На уровень крупнее трек бы не влез по ширине или высоте.
    const next = lat.map((la, i) => project(la, lon[i] ?? 0, layout.zoom + 1));
    const w = Math.max(...next.map((p) => p.x)) - Math.min(...next.map((p) => p.x));
    const h = Math.max(...next.map((p) => p.y)) - Math.min(...next.map((p) => p.y));
    expect(w > PREVIEW.width - 2 * PREVIEW.paddingPx || h > PREVIEW.height - 2 * PREVIEW.paddingPx).toBe(true);
  });

  it('тайлы покрывают окно картинки целиком', () => {
    if (!layout) throw new Error('layout expected');
    expect(layout.crop.left).toBeGreaterThanOrEqual(0);
    expect(layout.crop.top).toBeGreaterThanOrEqual(0);
    expect(layout.crop.left + PREVIEW.width).toBeLessThanOrEqual(layout.canvas.width);
    expect(layout.crop.top + PREVIEW.height).toBeLessThanOrEqual(layout.canvas.height);
    expect(layout.tiles.length).toBe((layout.canvas.width / 256) * (layout.canvas.height / 256));
  });

  it('точка или крошечный полёт — самый крупный масштаб; пусто — null', () => {
    expect(previewLayout([43.1], [76.9])?.zoom).toBe(PREVIEW.maxZoom);
    expect(previewLayout([], [])).toBeNull();
  });
});
