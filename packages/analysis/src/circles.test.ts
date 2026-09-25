import { CIRCLE, MOTION, type Circle } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { cleanAndDerive } from './clean-derive.js';
import { detectCircles, type CircleColumns } from './circles.js';
import { haversineDistance } from './geo.js';
import { computeMotion } from './motion.js';
import { expectation, parseFixture } from './testing/tracks.js';

/**
 * ТЗ §6.2, детекция кругов. Эталон — истинная траектория генератора фикстур
 * (fixtures/expected.json → trajectory): спираль по часовой, период 20 с,
 * радиус 62 м, набор 1.75 м/с, снос (1.4, 0.5) м/с; 240 с спирали, 240 с глайда.
 *
 * Число кругов, направление и период — дискретные, сверяются точно.
 * Радиус, центр и набор — с допуском: IGC округляет координаты до 0.001′
 * (≈1.85 м по широте), высоту — до метра, воркер ещё сглаживает медианой.
 * Точнее, чем позволяет запись в файл, эталона не существует.
 */

const PARAGLIDER = CIRCLE.paraglider;
/** Квантование IGC (≈1.85 м) + медианный фильтр координат (окно 3). */
const GEOMETRY_TOLERANCE_M = 3;
/** Высота в IGC — целые метры, после сглаживания Савицкого–Голея. */
const GAIN_TOLERANCE_M = 1.5;
/** Порог 360° пересекается с точностью до шага курса: ±2 шага по 1 с. */
const PERIOD_JITTER_S = 2;
const MEAN_PERIOD_TOLERANCE_S = 0.5;
/** Окно сглаживания высоты (CLEAN.altitudeSmoothingWindow = 9) и круг после него. */
const ALTITUDE_SMOOTHING_REACH = 25;

function derivedCircles(name: string): { circles: Circle[]; columns: CircleColumns } {
  const derived = cleanAndDerive(parseFixture(name));
  const columns: CircleColumns = {
    t: derived.points.t,
    lat: derived.points.lat,
    lon: derived.points.lon,
    altitude: derived.points.altitude,
    heading: derived.points.heading,
  };
  return { circles: detectCircles(columns, PARAGLIDER), columns };
}

describe('detectCircles на baseline.igc — спираль из генератора фикстур', () => {
  const trajectory = expectation('baseline.igc').trajectory;
  const { circles, columns } = derivedCircles('baseline.igc');

  it('по 11 кругов на каждую из двух спиралей', () => {
    // Спираль — ровно 12 оборотов (240 с × 18 °/с). Двенадцатый кончается там,
    // где начинается глайд: курс «от точки к следующей» видит в нём 19 шагов
    // поворота из 20 — полного круга по курсу нет. Это свойство метода §6.2.
    const climbStart = (i: number): number => i * trajectory.cyclePoints;
    const inClimb = (circle: Circle, start: number): boolean =>
      circle.startIndex >= start - 1 && circle.endIndex <= start + trajectory.climbPoints;
    expect(circles).toHaveLength(22);
    expect(circles.filter((c) => inClimb(c, climbStart(0)))).toHaveLength(11);
    expect(circles.filter((c) => inClimb(c, climbStart(1)))).toHaveLength(11);
  });

  it('направление — по часовой, период — 20 с', () => {
    // Курс по округлённым координатам шумит на ±5°: 360° набирается за 19–22
    // шага. Каждый круг — в пределах ±2 с, в среднем — ровно период спирали.
    for (const circle of circles) {
      expect(circle.direction).toBe(trajectory.turnDirection);
      expect(Math.abs(circle.periodS - trajectory.circlePeriodS)).toBeLessThanOrEqual(PERIOD_JITTER_S);
      expect(circle.endTimeMs - circle.startTimeMs).toBe(circle.periodS * 1000);
    }
    const mean = circles.reduce((sum, c) => sum + c.periodS, 0) / circles.length;
    expect(Math.abs(mean - trajectory.circlePeriodS)).toBeLessThanOrEqual(MEAN_PERIOD_TOLERANCE_S);
  });

  it('радиус — 62 м (в сносе, а не по земле), набор — 1.75 м/с за период круга', () => {
    for (const circle of circles) {
      expect(Math.abs(circle.radiusM - trajectory.circleRadiusM)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_M);
      // На стыке циклов генератор переносит пилота на 2.5 км и +288 м за секунду;
      // сглаживание высоты (окно 9) размазывает скачок — первые круги после стыка не в счёт.
      if (Math.abs(circle.startIndex - trajectory.cyclePoints) < ALTITUDE_SMOOTHING_REACH) continue;
      expect(Math.abs(circle.gainM - trajectory.climbRateMs * circle.periodS)).toBeLessThanOrEqual(GAIN_TOLERANCE_M);
    }
  });

  it('центр — истинный центр круга, сдвинутый сносом к середине оборота', () => {
    const originLat = columns.lat[0] ?? Number.NaN;
    const originLon = columns.lon[0] ?? Number.NaN;
    const mLat = trajectory.metresPerDegreeLat;
    const mLon = trajectory.metresPerDegreeLat * Math.cos((originLat * Math.PI) / 180);
    for (const circle of circles) {
      // В генераторе центр спирали — (0, −R) от начала цикла, плюс снос за полоборота.
      const cycle = Math.floor(circle.startIndex / trajectory.cyclePoints);
      const s = circle.startIndex - cycle * trajectory.cyclePoints + (trajectory.circlePeriodS - 1) / 2;
      const east = cycle * 5400 + trajectory.climbDriftEastMs * s;
      const north = cycle * 900 - trajectory.circleRadiusM + trajectory.climbDriftNorthMs * s;
      const distance = haversineDistance(circle.centerLat, circle.centerLon, originLat + north / mLat, originLon + east / mLon);
      expect(distance).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_M);
    }
  });

  it('круги спирали идут встык, без перекрытий', () => {
    for (let k = 1; k < circles.length; k++) {
      expect(circles[k]?.startIndex).toBeGreaterThanOrEqual(circles[k - 1]?.endIndex ?? Number.POSITIVE_INFINITY);
    }
  });
});

/* ── Синтетические траектории: граничные случаи отсечек §6.2 ─────────────── */

const LAT0 = 43.2;
const LON0 = 76.9;
const M_LAT = 111_320;
const mLon = M_LAT * Math.cos((LAT0 * Math.PI) / 180);
const START = Date.UTC(2026, 6, 15, 10);

/** Колонки 1 Гц по функции смещения (восток, север, м) и высоты; курс — как в воркере. */
function columnsOf(seconds: number, at: (s: number) => { east: number; north: number; up?: number }): CircleColumns {
  const n = seconds + 1;
  const t = Float64Array.from({ length: n }, (_, s) => START + s * 1000);
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const altitude = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    const p = at(s);
    lat[s] = LAT0 + p.north / M_LAT;
    lon[s] = LON0 + p.east / mLon;
    altitude[s] = 1500 + (p.up ?? 0);
  }
  const { heading } = computeMotion(t, lat, lon, {
    intervalS: 1,
    minMovementM: MOTION.minMovementForHeadingM,
    turnRate: false,
  });
  return { t, lat, lon, altitude, heading };
}

/** Круги радиуса r с периодом p; ccw — против часовой. */
const spiral = (r: number, p: number, ccw = false) => (s: number) => {
  const a = ((ccw ? -1 : 1) * 2 * Math.PI * s) / p;
  return { east: r * Math.sin(a), north: r * Math.cos(a), up: 1.2 * s };
};

describe('detectCircles — отсечки §6.2', () => {
  it('против часовой — ccw', () => {
    const circles = detectCircles(columnsOf(200, spiral(40, 20, true)), PARAGLIDER);
    expect(circles.length).toBeGreaterThanOrEqual(8);
    expect(circles.every((c) => c.direction === 'ccw')).toBe(true);
    expect(circles.every((c) => Math.abs(c.radiusM - 40) < 1)).toBe(true);
  });

  it('дрожание курса в обратную сторону меньше 10° — шум, круг не теряется', () => {
    // Каждый 7-й шаг курс чуть откатывается (−2°), как у округлённых координат IGC
    // (0.001′ ≈ 1.85 м на хорде 10–20 м); следующий шаг это догоняет.
    const columns = columnsOf(200, spiral(40, 20));
    for (let s = 7; s < columns.heading.length; s += 7) columns.heading[s] = (columns.heading[s - 1] ?? 0) - 2;
    const circles = detectCircles(columns, PARAGLIDER);
    expect(circles.length).toBeGreaterThanOrEqual(8);
    expect(circles.every((c) => c.direction === 'cw')).toBe(true);
  });

  it('прямой полёт — кругов нет', () => {
    expect(detectCircles(columnsOf(300, (s) => ({ east: 10 * s, north: 2 * s })), PARAGLIDER)).toEqual([]);
  });

  it('восьмёрка: направление меняется на каждой половине — кругов нет', () => {
    // Два касающихся круга по 40 м: полкруга вправо, полкруга влево — 180° в одну сторону, не 360°.
    const eight = (s: number) => {
      const half = Math.floor(s / 10) % 2 === 0;
      const a = (Math.PI * (s % 10)) / 10;
      return half ? { east: 40 - 40 * Math.cos(a), north: 40 * Math.sin(a) } : { east: -40 + 40 * Math.cos(a), north: -40 * Math.sin(a) };
    };
    expect(detectCircles(columnsOf(300, eight), PARAGLIDER)).toEqual([]);
  });

  it('радиус вне 15–120 м — не круг', () => {
    // 200 м за 30 с (42 м/с) и 8 м за 12 с — вне пределов параплана.
    expect(detectCircles(columnsOf(300, spiral(200, 30)), PARAGLIDER)).toEqual([]);
    expect(detectCircles(columnsOf(300, spiral(8, 12)), PARAGLIDER)).toEqual([]);
  });

  it('период больше 35 с — это не вираж, а плавный разворот', () => {
    expect(detectCircles(columnsOf(400, spiral(100, 60)), PARAGLIDER)).toEqual([]);
  });

  it('разрыв (курса нет) обрывает накопление: круг не склеивается через дыру', () => {
    const columns = columnsOf(200, spiral(40, 20));
    // Дыра на 5 с посреди второго оборота: пилот «стоял» — курса нет.
    for (let s = 25; s < 30; s++) columns.heading[s] = Number.NaN;
    const circles = detectCircles(columns, PARAGLIDER);
    expect(circles.every((c) => c.endIndex <= 25 || c.startIndex >= 29)).toBe(true);
  });

  it('пустой вход — пустой результат', () => {
    const empty = new Float64Array();
    expect(detectCircles({ t: empty, lat: empty, lon: empty, altitude: empty, heading: empty }, PARAGLIDER)).toEqual([]);
  });

  it('детерминирован: тот же вход — тот же выход', () => {
    const columns = columnsOf(200, spiral(40, 20));
    expect(detectCircles(columns, PARAGLIDER)).toEqual(detectCircles(columns, PARAGLIDER));
  });
});
