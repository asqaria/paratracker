import { describe, expect, it } from 'vitest';

import { flownByTime, smoothTrack, SMOOTH } from './track-smooth';

/**
 * Сглаживание трека для отрисовки: запись раз в секунду — круг термика за 20 с
 * рисовался ломаной из 20 отрезков. Между точками — промежуточные на кривой
 * Catmull-Rom: она проходит ровно через исходные точки.
 */

const START = Date.UTC(2026, 6, 15, 10);
/** Круг радиусом 1 (градус — условно) за 20 с. */
function circle(points: number, periodS = 20) {
  const t = Float64Array.from({ length: points }, (_, i) => START + i * 1000);
  const lat = Float64Array.from({ length: points }, (_, i) => Math.cos((2 * Math.PI * i) / periodS));
  const lon = Float64Array.from({ length: points }, (_, i) => Math.sin((2 * Math.PI * i) / periodS));
  const alt = Float64Array.from({ length: points }, (_, i) => 1000 + i);
  const vSpeed = new Float64Array(points).fill(1);
  return { t, lat, lon, alt, vSpeed };
}

describe('smoothTrack', () => {
  const track = circle(21);
  const smooth = smoothTrack(track);

  it('исходные точки на месте, между ними — SMOOTH.subdivisions − 1 новых', () => {
    expect(smooth.t.length).toBe((21 - 1) * SMOOTH.subdivisions + 1);
    for (let i = 0; i < 21; i++) {
      const k = i * SMOOTH.subdivisions;
      expect(smooth.t[k]).toBe(track.t[i]);
      expect(smooth.lat[k]).toBe(track.lat[i]);
      expect(smooth.lon[k]).toBe(track.lon[i]);
      expect(smooth.sourceIndex[k]).toBe(i);
    }
  });

  it('промежуточные точки — на дуге, а не на хорде: ломаная становится кругом', () => {
    // Середина хорды между соседними точками круга — на 1 − cos(9°) ≈ 1.2 % внутри;
    // сплайн почти на окружности.
    const mid = SMOOTH.subdivisions / 2;
    for (let i = 1; i < 19; i++) {
      const k = i * SMOOTH.subdivisions + mid;
      const radius = Math.hypot(smooth.lat[k] ?? 0, smooth.lon[k] ?? 0);
      expect(Math.abs(radius - 1)).toBeLessThan(0.002);
    }
  });

  it('время промежуточных — равномерно между соседними; вершина относится к отрезку своей начальной точки', () => {
    expect(smooth.t[1]).toBe(START + 1000 / SMOOTH.subdivisions);
    expect(smooth.sourceIndex[1]).toBe(0);
  });

  it('через разрыв записи не сглаживается: там прямая, как и была', () => {
    const t = Float64Array.from([0, 1000, 2000, 62_000, 63_000].map((ms) => START + ms));
    const lat = Float64Array.from([0, 1, 0, 5, 6]);
    const lon = Float64Array.from([0, 1, 2, 3, 3]);
    const flat = new Float64Array(5);
    const gap = smoothTrack({ t, lat, lon, alt: flat, vSpeed: flat });
    const k = 2 * SMOOTH.subdivisions + SMOOTH.subdivisions / 2;
    // Середина разрыва — ровно посередине прямой между точками 2 и 3.
    expect(gap.lat[k]).toBeCloseTo(2.5, 9);
    expect(gap.lon[k]).toBeCloseTo(2.5, 9);
  });

  it('пустой и одноточечный трек — как есть', () => {
    expect(smoothTrack(circle(1)).t.length).toBe(1);
    expect(smoothTrack(circle(0)).t.length).toBe(0);
  });
});

describe('flownByTime', () => {
  const times = Float64Array.from([0, 250, 500, 750, 1000]);
  it('вершины со временем не позже момента', () => {
    expect(flownByTime(times, -1)).toBe(0);
    expect(flownByTime(times, 0)).toBe(1);
    expect(flownByTime(times, 600)).toBe(3);
    expect(flownByTime(times, 2000)).toBe(5);
  });
});
