import { describe, expect, it } from 'vitest';

import { buildTrackGeometry } from './track-geometry';
import { varioRgba } from './vario-palette';

const columns = (
  lat: number[],
  lon: number[],
  alt: number[],
  vSpeed: number[],
): Parameters<typeof buildTrackGeometry>[0] => ({
  lat: Float64Array.from(lat),
  lon: Float64Array.from(lon),
  alt: Float64Array.from(alt),
  vSpeed: Float64Array.from(vSpeed),
});

describe('buildTrackGeometry', () => {
  it('позиции идут тройками «долгота, широта, высота»', () => {
    const geometry = buildTrackGeometry(columns([43.1, 43.2], [76.9, 77.0], [2350, 2400], [1, -1]));

    expect(Array.from(geometry.positions)).toEqual([76.9, 43.1, 2350, 77.0, 43.2, 2400]);
    expect(Array.from(geometry.groundPositions)).toEqual([76.9, 43.1, 77.0, 43.2]);
    expect(geometry.pointCount).toBe(2);
  });

  it('цвет на каждую вершину — по вариометру', () => {
    const geometry = buildTrackGeometry(columns([43.1, 43.2], [76.9, 77.0], [2350, 2400], [5, -5]));

    expect(Array.from(geometry.colors)).toEqual([...varioRgba(5), ...varioRgba(-5)]);
    expect(geometry.colors.length).toBe(geometry.pointCount * 4);
  });

  it('точки без координат или высоты пропускаются', () => {
    const geometry = buildTrackGeometry(
      columns([43.1, Number.NaN, 43.3], [76.9, 77.0, 77.1], [2350, 2400, Number.NaN], [1, 1, 1]),
    );

    expect(geometry.pointCount).toBe(1);
    expect(Array.from(geometry.positions)).toEqual([76.9, 43.1, 2350]);
  });

  it('пустой трек — пустые массивы, а не падение', () => {
    const geometry = buildTrackGeometry(columns([], [], [], []));
    expect(geometry).toMatchObject({ pointCount: 0 });
    expect(geometry.positions.length).toBe(0);
  });

  it('ходьба до взлёта и после посадки — серым, полёт — по вариометру', () => {
    const ground: [number, number, number, number] = [139, 151, 168, 255];
    const geometry = buildTrackGeometry(
      columns([43.1, 43.2, 43.3, 43.4], [76.9, 77.0, 77.1, 77.2], [2350, 2400, 2450, 2500], [5, 5, -5, -5]),
      { flight: { takeoff: 1, landing: 2 }, groundRgba: ground },
    );

    expect(Array.from(geometry.colors)).toEqual([...ground, ...varioRgba(5), ...varioRgba(-5), ...ground]);
  });

  it('индексы полёта — по исходным точкам, даже если часть точек пропущена', () => {
    const ground: [number, number, number, number] = [139, 151, 168, 255];
    const geometry = buildTrackGeometry(
      columns([Number.NaN, 43.2, 43.3], [76.9, 77.0, 77.1], [2350, 2400, 2450], [5, 5, 5]),
      { flight: { takeoff: 2, landing: 2 }, groundRgba: ground },
    );

    expect(Array.from(geometry.colors)).toEqual([...ground, ...varioRgba(5)]);
  });
});
