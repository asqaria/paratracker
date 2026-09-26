import { CIRCLE, GEO, MOTION, WIND, type Wind, type WindAnalysis } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { detectCircles } from './circles.js';
import { cleanAndDerive } from './clean-derive.js';
import { computeMotion } from './motion.js';
import { LAT0, LON0, M_LAT, M_LON, START } from './testing/legs.js';
import { expectation, median, parseFixture } from './testing/tracks.js';
import { detectThermals, type ThermalColumns } from './thermals.js';
import { estimateWind, fitVelocityCircle } from './wind.js';

/**
 * ТЗ §6.5, оценка ветра. Метод B — окружность в пространстве путевых скоростей
 * на каждом круге (подгонка Левенбергом–Марквардтом, не Kåsa), профиль по слоям
 * высоты; метод A — снос термика, сверка с B. Направление — метеорологическое.
 */

const PARAGLIDER = CIRCLE.paraglider;
/** Генератор и синтетика считают градус широты за M_LAT, гаверсинус — по GEO.meanEarthRadiusM. */
const SPHERE_SCALE = (GEO.meanEarthRadiusM * Math.PI) / 180 / M_LAT;
/** IGC пишет минуты с тремя знаками: 60 000 шагов на градус (≈ 1.85 м). */
const IGC_MINUTE_STEPS = 60_000;
const igc = (deg: number): number => Math.round(deg * IGC_MINUTE_STEPS) / IGC_MINUTE_STEPS;

/** Откуда дует ветер, который дует на (east, north): метеорологическое направление. */
const fromDeg = (east: number, north: number): number => ((Math.atan2(east, north) * 180) / Math.PI + 180 + 360) % 360;
/** Разность направлений в (−180, 180]. */
const angleDiff = (a: number, b: number): number => ((((a - b) % 360) + 540) % 360) - 180;

function analyse(columns: ThermalColumns): WindAnalysis {
  const circles = detectCircles(columns, PARAGLIDER);
  const thermals = detectThermals(columns, circles, PARAGLIDER);
  return estimateWind(columns, circles, thermals, WIND.paraglider);
}

function expectWind(wind: Wind | null | undefined, east: number, north: number, toleranceMs: number): void {
  expect(wind).toBeDefined();
  expect(wind).not.toBeNull();
  if (!wind) return;
  expect(Math.abs(wind.eastMs - east)).toBeLessThanOrEqual(toleranceMs);
  expect(Math.abs(wind.northMs - north)).toBeLessThanOrEqual(toleranceMs);
  expect(wind.speedMs).toBeCloseTo(Math.hypot(wind.eastMs, wind.northMs), 9);
  expect(Math.abs(angleDiff(wind.dirDeg, fromDeg(wind.eastMs, wind.northMs)))).toBeLessThan(1e-9);
}

/* ── Подгонка окружности ────────────────────────────────────────────────── */

describe('fitVelocityCircle — окружность в пространстве скоростей', () => {
  it('точки на окружности — центр и радиус точно', () => {
    const angles = Array.from({ length: 24 }, (_, k) => (2 * Math.PI * k) / 24);
    const fit = fitVelocityCircle(
      Float64Array.from(angles, (a) => 3 + 11 * Math.sin(a)),
      Float64Array.from(angles, (a) => -2 + 11 * Math.cos(a)),
    );
    expect(fit?.centerEast).toBeCloseTo(3, 9);
    expect(fit?.centerNorth).toBeCloseTo(-2, 9);
    expect(fit?.radius).toBeCloseTo(11, 9);
    expect(fit?.residual).toBeCloseTo(0, 9);
  });

  it('треть окружности с шумом — радиус не занижен (Kåsa на неполной дуге занижает)', () => {
    // Детерминированный шум ±0.4 м/с — как у скорости по округлённым координатам IGC.
    let seed = 7;
    const noise = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return (seed / 2 ** 31 - 0.5) * 0.8;
    };
    const angles = Array.from({ length: 12 }, (_, k) => (((2 * Math.PI) / 3) * k) / 11);
    const fit = fitVelocityCircle(
      Float64Array.from(angles, (a) => 4 + 10 * Math.sin(a) + noise()),
      Float64Array.from(angles, (a) => 1 + 10 * Math.cos(a) + noise()),
    );
    expect(Math.abs((fit?.radius ?? 0) - 10)).toBeLessThan(0.3);
    expect(Math.abs((fit?.centerEast ?? 0) - 4)).toBeLessThan(0.5);
    expect(Math.abs((fit?.centerNorth ?? 0) - 1)).toBeLessThan(0.5);
  });

  it('меньше трёх точек — не подгоняется', () => {
    expect(fitVelocityCircle(Float64Array.of(1, 2), Float64Array.of(0, 1))).toBeNull();
  });
});

/* ── baseline.igc ───────────────────────────────────────────────────────── */

describe('estimateWind на baseline.igc — спирали генератора в ветре', () => {
  const trajectory = expectation('baseline.igc').trajectory;
  const p = cleanAndDerive(parseFixture('baseline.igc')).points;
  const wind = analyse({ t: p.t, lat: p.lat, lon: p.lon, altitude: p.altitude, heading: p.heading, vSpeed: p.vSpeedDamped });
  const east = trajectory.climbDriftEastMs * SPHERE_SCALE;
  const north = trajectory.climbDriftNorthMs * SPHERE_SCALE;
  /** Воздушная скорость в вираже: окружность 62 м за 20 с. */
  const airspeed = ((2 * Math.PI * trajectory.circleRadiusM) / trajectory.circlePeriodS) * SPHERE_SCALE;
  /**
   * Округление IGC (1.85 м) даёт скорости центральной разностью шум σ ≈ 0.4 м/с на
   * отсчёт; центр окружности по 20 отсчётам — σ ≈ 0.12 м/с, худший из 42 значений
   * (21 круг × 2 оси) — до 0.3. Среднее по слою — уже десятые доли.
   */
  const CIRCLE_TOLERANCE_MS = 0.3;
  const TOLERANCE_MS = 0.15;

  it('каждый круг: ветер (1.4, 0.5) м/с — откуда 250°; воздушная 19.5 м/с', () => {
    // Из 22 кругов отбракован один — начинается на стыке циклов, где генератор
    // переносит пилота на +288 м за секунду: окружности скоростей там нет.
    const circles = detectCircles(
      { t: p.t, lat: p.lat, lon: p.lon, altitude: p.altitude, heading: p.heading },
      PARAGLIDER,
    );
    expect(circles).toHaveLength(22);
    const rejected = circles.filter((_, index) => !wind.circles.some((c) => c.circleIndex === index));
    expect(rejected.map((c) => c.startIndex)).toEqual([trajectory.cyclePoints]);
    for (const circle of wind.circles) {
      expectWind(circle.wind, east, north, CIRCLE_TOLERANCE_MS);
      // Воздушная — с поправкой на хорду; остаток — медианный фильтр координат (окно 3) чуть сжимает круг.
      expect(Math.abs(circle.airspeedMs - airspeed)).toBeLessThanOrEqual(CIRCLE_TOLERANCE_MS);
    }
    expect(Math.abs(angleDiff(wind.flight?.dirDeg ?? Number.NaN, fromDeg(east, north)))).toBeLessThan(5);
  });

  it('профиль: слои по 250 м снизу вверх, в каждом тот же ветер, уверенность высокая', () => {
    expect(wind.profile.length).toBeGreaterThanOrEqual(3);
    wind.profile.forEach((band, k) => {
      expect(band.altitudeBand[1] - band.altitudeBand[0]).toBe(WIND.bandHeightM);
      expect(band.altitudeBand[0] % WIND.bandHeightM).toBe(0);
      if (k > 0) expect(band.altitudeBand[0]).toBeGreaterThan(wind.profile[k - 1]?.altitudeBand[0] ?? Infinity);
      expect(Math.abs(band.windSpeedMs - Math.hypot(east, north))).toBeLessThanOrEqual(TOLERANCE_MS);
      expect(Math.abs(angleDiff(band.windDirDeg, fromDeg(east, north)))).toBeLessThan(5);
      expect(band.confidence).toBeGreaterThan(0.6);
      expect(band.confidence).toBeLessThanOrEqual(1);
    });
  });

  it('метод A (снос) и метод B (круги) согласны: снос развёрнут в «откуда дует»', () => {
    expect(wind.thermals).toHaveLength(2);
    for (const thermal of wind.thermals) {
      expectWind(thermal.drift, east, north, 0.1);
      expect(thermal.disagreementMs).toBeLessThan(0.2);
    }
  });
});

/* ── Синтетика ──────────────────────────────────────────────────────────── */

interface Windy {
  seconds: number;
  airspeedMs: number;
  periodS: number;
  climbMs: number;
  /** Ветер на высоте, куда дует, м/с. */
  windAt: (altitudeM: number) => [east: number, north: number];
}

/** Вираж по часовой в ветре: снос интегрируется по высоте, координаты округлены как в IGC. */
function windyCircles({ seconds, airspeedMs, periodS, climbMs, windAt }: Windy): ThermalColumns {
  const n = seconds + 1;
  const radius = (airspeedMs * periodS) / (2 * Math.PI);
  const omega = (2 * Math.PI) / periodS;
  const east: number[] = [];
  const north: number[] = [];
  const up: number[] = [];
  let driftE = 0;
  let driftN = 0;
  for (let s = 0; s < n; s++) {
    const altitude = 1500 + climbMs * s;
    east.push(driftE + radius * Math.sin(omega * s));
    north.push(driftN + radius * Math.cos(omega * s));
    up.push(altitude);
    const [we, wn] = windAt(altitude);
    driftE += we;
    driftN += wn;
  }
  const t = Float64Array.from({ length: n }, (_, s) => START + s * 1000);
  const lat = Float64Array.from(north, (y) => igc(LAT0 + y / M_LAT));
  const lon = Float64Array.from(east, (x) => igc(LON0 + x / M_LON));
  const altitude = Float64Array.from(up);
  const vSpeed = new Float64Array(n).fill(climbMs);
  const { heading } = computeMotion(t, lat, lon, { intervalS: 1, minMovementM: MOTION.minMovementForHeadingM, turnRate: false });
  return { t, lat, lon, altitude, heading, vSpeed };
}

describe('estimateWind — синтетика', () => {
  it('сильный ветер 9 м/с при воздушной 10 м/с: против ветра пилот почти стоит, ветер всё равно находится', () => {
    const wind = analyse(windyCircles({ seconds: 300, airspeedMs: 10, periodS: 16, climbMs: 2, windAt: () => [9, 0] }));
    expect(wind.circles.length).toBeGreaterThan(10);
    for (const circle of wind.circles) expectWind(circle.wind, 9 * SPHERE_SCALE, 0, 0.4);
    // Дует на восток — значит, с запада.
    expect(Math.abs(angleDiff(wind.flight?.dirDeg ?? Number.NaN, 270))).toBeLessThan(3);
  });

  it('два слоя: ниже 1750 м — западный, выше 2000 м — северный; профиль их различает', () => {
    const wind = analyse(
      windyCircles({ seconds: 600, airspeedMs: 11, periodS: 20, climbMs: 2, windAt: (h) => (h < 1750 ? [6, 0] : [0, -6]) }),
    );
    const below = wind.profile.filter((band) => band.altitudeBand[1] <= 1750);
    const above = wind.profile.filter((band) => band.altitudeBand[0] >= 2000);
    expect(below.length).toBeGreaterThan(0);
    expect(above.length).toBeGreaterThan(0);
    for (const band of below) expect(Math.abs(angleDiff(band.windDirDeg, 270))).toBeLessThan(5);
    for (const band of above) expect(Math.abs(angleDiff(band.windDirDeg, 0))).toBeLessThan(5);
  });

  it('воздушная скорость вне пределов типа ЛА — круг отбракован, ветра нет', () => {
    // 30 м/с по кругу — не параплан в вираже (WIND.paraglider.maxMs).
    const wind = analyse(windyCircles({ seconds: 200, airspeedMs: 30, periodS: 20, climbMs: 2, windAt: () => [2, 0] }));
    expect(wind.circles).toEqual([]);
    expect(wind.profile).toEqual([]);
    expect(wind.flight).toBeNull();
  });

  it('кругов нет — пустой результат', () => {
    const empty = new Float64Array();
    const columns: ThermalColumns = { t: empty, lat: empty, lon: empty, altitude: empty, heading: empty, vSpeed: empty };
    expect(estimateWind(columns, [], [], WIND.paraglider)).toEqual({ circles: [], profile: [], thermals: [], flight: null });
  });
});

/* ── Реальный трек в ветре ~35 км/ч (fixtures/real-wind-thermals.igc) ───── */

describe('estimateWind на реальном треке', () => {
  const p = cleanAndDerive(parseFixture('real-wind-thermals.igc')).points;
  const wind = analyse({ t: p.t, lat: p.lat, lon: p.lon, altitude: p.altitude, heading: p.heading, vSpeed: p.vSpeedDamped });

  it('ветер северо-восточный, несколько м/с — как по глайдам (glides.test.ts)', () => {
    // Независимое свидетельство — переходы: медленнее всех (20–25 км/ч, качество
    // 4–6) шли курсом 37–62°, то есть против ветра; на запад — 40–48 км/ч.
    const flight = wind.flight;
    expect(flight?.speedMs).toBeGreaterThan(2);
    expect(flight?.speedMs).toBeLessThan(7);
    expect(flight?.dirDeg).toBeGreaterThan(20);
    expect(flight?.dirDeg).toBeLessThan(80);
  });

  it('методы согласны: медиана расхождения сноса и кругов по термикам меньше 2 м/с', () => {
    const disagreements = wind.thermals.flatMap((thermal) => (thermal.disagreementMs === null ? [] : [thermal.disagreementMs]));
    expect(disagreements.length).toBeGreaterThan(10);
    expect(median(disagreements)).toBeLessThan(2);
  });

  it('профиль: слои снизу вверх, уверенность 0..1, воздушная скорость — параплана', () => {
    expect(wind.profile.length).toBeGreaterThan(3);
    for (const band of wind.profile) {
      expect(band.confidence).toBeGreaterThanOrEqual(0);
      expect(band.confidence).toBeLessThanOrEqual(1);
      expect(band.circleCount).toBeGreaterThan(0);
    }
    for (const circle of wind.circles) {
      expect(circle.airspeedMs).toBeGreaterThanOrEqual(WIND.paraglider.minMs);
      expect(circle.airspeedMs).toBeLessThanOrEqual(WIND.paraglider.maxMs);
    }
  });
});
