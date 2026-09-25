import { CIRCLE, MOTION, THERMAL, type Thermal } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { detectCircles } from './circles.js';
import { cleanAndDerive } from './clean-derive.js';
import { computeMotion } from './motion.js';
import { expectation, parseFixture } from './testing/tracks.js';
import { detectThermals, type ThermalColumns } from './thermals.js';

/**
 * ТЗ §6.3, детекция термиков. Эталон — истинная траектория генератора
 * (fixtures/expected.json → trajectory): две спирали по 240 с, набор 1.75 м/с,
 * снос (1.4, 0.5) м/с, радиус 62 м, по часовой. Границы и цифры термика —
 * с допуском на округление IGC и сглаживание (см. circles.test.ts).
 */

const PARAGLIDER = CIRCLE.paraglider;
/**
 * Граница термика — конец набора; высота сглажена окном 9 отсчётов (±4 с,
 * CLEAN.altitudeSmoothingWindow), и сглаженный набор заходит в глайд на столько же.
 */
const BOUNDARY_TOLERANCE_S = 4;
/** Средний набор по округлённой до метра высоте за ~240 с. */
const CLIMB_TOLERANCE_MS = 0.05;
/** Снос по центрам кругов (±3 м) за ~200 с. */
const DRIFT_TOLERANCE_MS = 0.05;
const RADIUS_TOLERANCE_M = 3;

function thermalsOf(name: string): Thermal[] {
  const derived = cleanAndDerive(parseFixture(name));
  const p = derived.points;
  const columns: ThermalColumns = { t: p.t, lat: p.lat, lon: p.lon, altitude: p.altitude, heading: p.heading, vSpeed: p.vSpeedDamped };
  return detectThermals(columns, detectCircles(columns, PARAGLIDER), PARAGLIDER);
}

describe('detectThermals на baseline.igc — две спирали генератора', () => {
  const trajectory = expectation('baseline.igc').trajectory;
  const thermals = thermalsOf('baseline.igc');
  const second = 1000;

  it('два термика — по одному на каждую спираль, границы совпадают с набором', () => {
    expect(thermals).toHaveLength(2);
    thermals.forEach((thermal, k) => {
      const climbStart = k * trajectory.cyclePoints;
      expect(Math.abs(thermal.startIndex - climbStart)).toBeLessThanOrEqual(BOUNDARY_TOLERANCE_S);
      expect(Math.abs(thermal.endIndex - (climbStart + trajectory.climbPoints))).toBeLessThanOrEqual(BOUNDARY_TOLERANCE_S);
      expect(thermal.durationS).toBe((thermal.endTimeMs - thermal.startTimeMs) / second);
    });
  });

  it('по часовой, почти 12 оборотов: 11 полных кругов и доворот до глайда', () => {
    for (const thermal of thermals) {
      expect(thermal.direction).toBe(trajectory.turnDirection);
      expect(thermal.circleCount).toBe(11);
      expect(thermal.turnCount).toBeGreaterThan(11.5);
      expect(thermal.turnCount).toBeLessThanOrEqual(12);
      expect(Math.abs(thermal.avgRadiusM - trajectory.circleRadiusM)).toBeLessThanOrEqual(RADIUS_TOLERANCE_M);
    }
  });

  it('снос — (1.4, 0.5) м/с, куда сносит (а не откуда дует)', () => {
    for (const thermal of thermals) {
      expect(Math.abs((thermal.driftEastMs ?? Number.NaN) - trajectory.climbDriftEastMs)).toBeLessThanOrEqual(DRIFT_TOLERANCE_MS);
      expect(Math.abs((thermal.driftNorthMs ?? Number.NaN) - trajectory.climbDriftNorthMs)).toBeLessThanOrEqual(DRIFT_TOLERANCE_MS);
    }
  });

  it('первый термик: набор 1.75 м/с, средний, центрирован чисто', () => {
    // Второй начинается на стыке циклов, где генератор переносит пилота на +288 м
    // за секунду — сглаженный скачок портит высоту входа; его цифры здесь не сверяются.
    const [first] = thermals;
    expect(first).toBeDefined();
    if (!first) return;
    expect(Math.abs(first.avgClimbMs - trajectory.climbRateMs)).toBeLessThanOrEqual(CLIMB_TOLERANCE_MS);
    expect(first.gainM).toBeCloseTo(first.exitAltM - first.entryAltM, 9);
    expect(first.avgClimbMs).toBeCloseTo(first.gainM / first.durationS, 9);
    expect(first.maxClimbMs).toBeGreaterThanOrEqual(first.avgClimbMs);
    expect(first.efficiency).toBeCloseTo(first.avgClimbMs / first.maxClimbMs, 9);
    expect(first.efficiency).toBeGreaterThan(0.8);
    expect(first.strength).toBe('medium');
  });
});

/* ── Синтетика: условия §6.3 ────────────────────────────────────────────── */

const LAT0 = 43.2;
const LON0 = 76.9;
const M_LAT = 111_320;
const mLon = M_LAT * Math.cos((LAT0 * Math.PI) / 180);
const START = Date.UTC(2026, 6, 15, 10);
/** IGC пишет минуты с тремя знаками: 60 000 шагов на градус. */
const IGC_MINUTE_STEPS = 60_000;

interface Leg {
  seconds: number;
  /** Градусов поворота в секунду: 18 — круг за 20 с; 0 — прямо. */
  turnDegS: number;
  climbMs: number;
}

/** Трек из участков: вираж или прямая с заданным набором; 10 м/с, окружность радиусом v/ω. */
function flight(legs: Leg[]): ThermalColumns {
  const east: number[] = [0];
  const north: number[] = [0];
  const up: number[] = [1500];
  let heading = 0;
  for (const leg of legs) {
    for (let s = 0; s < leg.seconds; s++) {
      heading += leg.turnDegS;
      east.push((east.at(-1) ?? 0) + 10 * Math.sin((heading * Math.PI) / 180));
      north.push((north.at(-1) ?? 0) + 10 * Math.cos((heading * Math.PI) / 180));
      up.push((up.at(-1) ?? 0) + leg.climbMs);
    }
  }
  const n = east.length;
  const t = Float64Array.from({ length: n }, (_, s) => START + s * 1000);
  const lat = Float64Array.from(north, (y) => LAT0 + y / M_LAT);
  const lon = Float64Array.from(east, (x) => LON0 + x / mLon);
  const altitude = Float64Array.from(up);
  const vSpeed = Float64Array.from(up, (_, s) => (up[Math.min(n - 1, s + 1)] ?? 0) - (up[Math.max(0, s - 1)] ?? 0)).map(
    (d, s) => d / (s === 0 || s === n - 1 ? 1 : 2),
  );
  const { heading: headings } = computeMotion(t, lat, lon, { intervalS: 1, minMovementM: MOTION.minMovementForHeadingM, turnRate: false });
  return { t, lat, lon, altitude, heading: headings, vSpeed };
}

const thermals = (columns: ThermalColumns): Thermal[] => detectThermals(columns, detectCircles(columns, PARAGLIDER), PARAGLIDER);
const glide: Leg = { seconds: 60, turnDegS: 0, climbMs: -1 };

describe('detectThermals — условия §6.3', () => {
  it('круги со снижением — не термик (спираль, слив)', () => {
    expect(thermals(flight([glide, { seconds: 100, turnDegS: 18, climbMs: -2 }, glide]))).toEqual([]);
  });

  it('набор 0.2 м/с и меньше — не термик', () => {
    expect(thermals(flight([glide, { seconds: 100, turnDegS: 18, climbMs: THERMAL.minAvgClimbMs }, glide]))).toEqual([]);
  });

  it('1.6 оборота с набором — термик; оборот с четвертью — нет (порог §6.3 — 1.5)', () => {
    const oneAndHalf = thermals(flight([glide, { seconds: 32, turnDegS: 18, climbMs: 1.5 }, glide]));
    expect(oneAndHalf).toHaveLength(1);
    expect(oneAndHalf[0]?.turnCount).toBeGreaterThanOrEqual(THERMAL.minTurns);
    expect(thermals(flight([glide, { seconds: 25, turnDegS: 18, climbMs: 1.5 }, glide]))).toEqual([]);
  });

  it('разрыв между кругами до 15 с — один термик, больше — два', () => {
    const climb: Leg = { seconds: 60, turnDegS: 18, climbMs: 1.5 };
    const shortPause: Leg = { seconds: 10, turnDegS: 0, climbMs: 0.5 };
    const longPause: Leg = { seconds: 25, turnDegS: 0, climbMs: -1 };
    expect(thermals(flight([glide, climb, shortPause, climb, glide]))).toHaveLength(1);
    expect(thermals(flight([glide, climb, longPause, climb, glide]))).toHaveLength(2);
  });

  it('пауза дольше 15 с, но с набором — перецентровка, тот же термик; со снижением — два', () => {
    // В ветре пилот выпадает из ядра и широко ищет его, продолжая набирать.
    const climb: Leg = { seconds: 60, turnDegS: 18, climbMs: 1.5 };
    const searching: Leg = { seconds: 50, turnDegS: 6, climbMs: 1.1 };
    const sinking: Leg = { seconds: 50, turnDegS: 6, climbMs: -1 };
    const merged = thermals(flight([glide, climb, searching, climb, glide]));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.durationS).toBeGreaterThan(160);
    expect(thermals(flight([glide, climb, sinking, climb, glide]))).toHaveLength(2);
  });

  it('набор по прямой после кругов — тот же термик, пока пилот набирает (граница — конец подъёма)', () => {
    // Круги минуту, затем 90 с прямо с набором 2 м/с (под облаком), затем глайд.
    const found = thermals(flight([glide, { seconds: 60, turnDegS: 18, climbMs: 1.5 }, { seconds: 90, turnDegS: 0, climbMs: 2 }, glide]));
    expect(found).toHaveLength(1);
    const end = found[0]?.endIndex ?? 0;
    expect(end).toBeGreaterThanOrEqual(60 + 60 + 90 - THERMAL.climbWindowS);
    expect(end).toBeLessThanOrEqual(60 + 60 + 90 + 2);
    expect(found[0]?.gainM).toBeGreaterThan(60 * 1.5 + 90 * 2 - THERMAL.climbWindowS * 2);
  });

  it('набор по прямой перед кругами — термик начинается с начала подъёма', () => {
    const found = thermals(flight([glide, { seconds: 60, turnDegS: 0, climbMs: 1.5 }, { seconds: 60, turnDegS: 18, climbMs: 1.5 }, glide]));
    expect(found).toHaveLength(1);
    expect(found[0]?.startIndex).toBeLessThanOrEqual(60 + THERMAL.climbWindowS);
  });

  it('два термика, между которыми 3 минуты набора по прямой, — один', () => {
    const climb: Leg = { seconds: 60, turnDegS: 18, climbMs: 1.5 };
    expect(thermals(flight([glide, climb, { seconds: 180, turnDegS: 0, climbMs: 1 }, climb, glide]))).toHaveLength(1);
  });

  it('набор по прямой без кругов — не термик (динамик, волна)', () => {
    expect(thermals(flight([glide, { seconds: 200, turnDegS: 0, climbMs: 2 }, glide]))).toEqual([]);
  });

  it('классы по среднему набору: слабый < 1, средний 1–3, сильный 3–5, мощный > 5 м/с', () => {
    const strengthAt = (climbMs: number) => thermals(flight([glide, { seconds: 80, turnDegS: 18, climbMs }, glide]))[0]?.strength;
    expect(strengthAt(0.6)).toBe('weak');
    expect(strengthAt(2)).toBe('medium');
    expect(strengthAt(4)).toBe('strong');
    expect(strengthAt(6)).toBe('powerful');
  });

  it('против часовой — ccw; один полный круг — сноса нет (не из чего считать)', () => {
    const [left] = thermals(flight([glide, { seconds: 32, turnDegS: -18, climbMs: 1.5 }, glide]));
    expect(left?.direction).toBe('ccw');
    expect(left?.driftEastMs).toBeNull();
    expect(left?.driftNorthMs).toBeNull();
  });

  it('кругов нет — термиков нет; пустой вход — пустой выход', () => {
    expect(thermals(flight([glide, glide]))).toEqual([]);
    const empty = new Float64Array();
    expect(detectThermals({ t: empty, lat: empty, lon: empty, altitude: empty, heading: empty, vSpeed: empty }, [], PARAGLIDER)).toEqual([]);
  });

  it('сильный ветер (путевая против ветра почти ноль) — один термик, а не россыпь', () => {
    // Воздушная 10 м/с по кругу 25 м, ветер 9 м/с: против ветра путевая 1 м/с —
    // курс по земле там не наблюдаем (шаг короче метра) или шумит на десятки градусов.
    const n = 301;
    const t = Float64Array.from({ length: n }, (_, s) => START + s * 1000);
    // Координаты округлены, как в IGC: до 0.001′ (1/60000 градуса ≈ 1.85 м по широте).
    const igc = (deg: number): number => Math.round(deg * IGC_MINUTE_STEPS) / IGC_MINUTE_STEPS;
    const lat = Float64Array.from({ length: n }, (_, s) => igc(LAT0 + (25 * Math.cos(0.4 * s)) / M_LAT));
    const lon = Float64Array.from({ length: n }, (_, s) => igc(LON0 + (9 * s + 25 * Math.sin(0.4 * s)) / mLon));
    const altitude = Float64Array.from({ length: n }, (_, s) => 1500 + 2 * s);
    const vSpeed = new Float64Array(n).fill(2);
    const { heading } = computeMotion(t, lat, lon, { intervalS: 1, minMovementM: MOTION.minMovementForHeadingM, turnRate: false });
    const columns: ThermalColumns = { t, lat, lon, altitude, heading, vSpeed };
    const found = detectThermals(columns, detectCircles(columns, PARAGLIDER), PARAGLIDER);
    expect(found).toHaveLength(1);
    expect(found[0]?.durationS).toBeGreaterThan(250);
    expect(Math.abs((found[0]?.driftEastMs ?? 0) - 9)).toBeLessThan(0.3);
  });
});
