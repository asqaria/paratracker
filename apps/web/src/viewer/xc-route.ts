import type { XcScoreDto } from '@skyline/core';

/**
 * Маршрут XC для сцены (ТЗ §6.6, задача 3.3) — без Cesium: слой только рисует.
 * Треугольник — замкнутое кольцо вершин (заливка + контур), свободная
 * дистанция — ломаная старт → ППМ → финиш.
 */

export interface XcRoute {
  /** [долгота, широта] по порядку; у треугольника последняя = первой. */
  path: [number, number][];
  closed: boolean;
  /** Точки с номерами на сцене: у треугольника — вершины, у дистанции — ППМ между стартом и финишем. */
  markers: { lat: number; lon: number; timeMs: number; label: string }[];
}

export function xcRoute(xc: XcScoreDto): XcRoute | null {
  if (xc.route.length < 2) return null;
  const path = xc.route.map((p): [number, number] => [p.lon, p.lat]);
  const closed = xc.type !== 'free_distance';
  const first = path[0];
  if (closed && first) path.push(first);
  // У дистанции старт и финиш видны концами линии; номера — только у ППМ.
  const numbered = closed ? xc.route : xc.route.slice(1, -1);
  return {
    path,
    closed,
    markers: numbered.map((p, i) => ({ lat: p.lat, lon: p.lon, timeMs: p.timeMs, label: String(i + 1) })),
  };
}
