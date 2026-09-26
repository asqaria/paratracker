import { CIRCLE, CLEAN, GEO, GLIDE, type DerivedColumns, type FlightRange, type Glide, type Thermal } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { detectCircles } from './circles.js';
import { cleanAndDerive } from './clean-derive.js';
import { flightRange } from './flight-range.js';
import { haversineDistance } from './geo.js';
import { detectGlides, type GlideColumns } from './glides.js';
import { flight, M_LAT, type Leg } from './testing/legs.js';
import { expectation, median, parseFixture } from './testing/tracks.js';
import { detectThermals, type ThermalColumns } from './thermals.js';

/**
 * ТЗ §6.4, детекция глайдов (переходов): от взлёта или конца термика до начала
 * следующего термика или посадки. Круги поиска, не ставшие термиком, — часть
 * перехода; переход короче GLIDE.minDurationS — не глайд.
 */

const PARAGLIDER = CIRCLE.paraglider;
/**
 * Синтетика и генератор фикстур считают градус широты за M_LAT = 111 320 м,
 * гаверсинус — по GEO.meanEarthRadiusM: одни и те же градусы — в столько раз
 * другие метры.
 */
const SPHERE_SCALE = (GEO.meanEarthRadiusM * Math.PI) / 180 / M_LAT;
/** Граница глайда — граница термика: высота сглажена окном 9 отсчётов, ±4 с. */
const BOUNDARY_TOLERANCE_S = 4;

interface Analysed {
  thermals: Thermal[];
  range: FlightRange;
  glides: Glide[];
}

function analyse(columns: ThermalColumns & { groundSpeed: Float64Array }): Analysed {
  const thermals = detectThermals(columns, detectCircles(columns, PARAGLIDER), PARAGLIDER);
  const range = flightRange(columns.t, columns.groundSpeed);
  return { thermals, range, glides: detectGlides(columns, thermals, range) };
}

function analyseFixture(name: string): Analysed & { points: DerivedColumns } {
  const p = cleanAndDerive(parseFixture(name)).points;
  const columns = { t: p.t, lat: p.lat, lon: p.lon, altitude: p.altitude, heading: p.heading, vSpeed: p.vSpeedDamped, groundSpeed: p.groundSpeed };
  return { ...analyse(columns), points: p };
}

/** Цифры глайда согласованы между собой: всё выводится из пути, времени и высот. */
function expectConsistent(glide: Glide): void {
  expect(glide.durationS).toBe((glide.endTimeMs - glide.startTimeMs) / 1000);
  expect(glide.avgGroundSpeedMs).toBeCloseTo(glide.distanceM / glide.durationS, 9);
  expect(glide.avgVzMs).toBeCloseTo(-glide.altLossM / glide.durationS, 9);
  expect(glide.headingConsistency).toBeGreaterThanOrEqual(0);
  expect(glide.headingConsistency).toBeLessThanOrEqual(1);
  if (glide.altLossM < GLIDE.dynamicMaxAltLossM) {
    expect(glide.kind).toBe('dynamic');
    expect(glide.glideRatio).toBeNull();
  } else {
    expect(glide.kind).toBe('glide');
    expect(glide.glideRatio).toBeCloseTo(Math.min(GLIDE.maxGlideRatio, glide.distanceM / glide.altLossM), 9);
  }
}

describe('detectGlides на baseline.igc — переходы генератора между спиралями', () => {
  const trajectory = expectation('baseline.igc').trajectory;
  const { thermals, glides, points } = analyseFixture('baseline.igc');
  const n = points.t.length;

  it('два глайда: между спиралями и финальный; до первой спирали — меньше 30 с, не глайд', () => {
    expect(thermals).toHaveLength(2);
    expect(glides).toHaveLength(2);
    const [first, second] = thermals;
    expect(glides[0]?.startIndex).toBe(first?.endIndex);
    expect(glides[0]?.endIndex).toBe(second?.startIndex);
    expect(glides[1]?.startIndex).toBe(second?.endIndex);
    expect(glides[1]?.endIndex).toBe(n - 1);
    glides.forEach(expectConsistent);
  });

  it('финальный глайд: снижение 1.2 м/с, путевая 10.75 м/с, курс 80°, качество ≈ 9', () => {
    // Первый переход кончается на стыке циклов, где генератор переносит пилота
    // на +288 м за секунду, — его цифры не сверяются (см. thermals.test.ts).
    const final = glides[1];
    expect(final).toBeDefined();
    if (!final) return;
    const speed = trajectory.glideGroundSpeedMs * SPHERE_SCALE;
    // На выходе из спирали генератор прыгает на −R по северу (спираль кончается
    // в dy = 0, глайд начинается с dy = −R): первый шаг глайда — не 10.75 м, а
    // сколько записано в файл. Путь — этот шаг плюс остальные с путевой генератора.
    const p = points;
    const s = final.startIndex;
    const jumpM = haversineDistance(p.lat[s] ?? 0, p.lon[s] ?? 0, p.lat[s + 1] ?? 0, p.lon[s + 1] ?? 0);
    const expectedDistanceM = speed * (final.durationS - 1) + jumpM;
    // Граница ±4 с внутри спирали и шум округления IGC (1.85 м) на пути ~2.5 км.
    expect(Math.abs(final.avgVzMs - trajectory.glideRateMs)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(final.avgGroundSpeedMs - expectedDistanceM / final.durationS)).toBeLessThanOrEqual(0.1);
    expect(Math.abs((final.glideRatio ?? Number.NaN) - expectedDistanceM / (-trajectory.glideRateMs * final.durationS))).toBeLessThanOrEqual(
      0.15,
    );
    // Тот же прыжок поперёк курса отклоняет прямую «начало → конец» на atan(прыжок / путь).
    const jumpDeg = (Math.atan(jumpM / expectedDistanceM) * 180) / Math.PI;
    expect(Math.abs(final.headingDeg - trajectory.glideTrackDeg)).toBeLessThanOrEqual(jumpDeg + 0.5);
    // Шёл прямо; путь длиннее прямой только на прыжок (и шум округления — полпроцента).
    expect(final.headingConsistency).toBeGreaterThan(1 - jumpM / expectedDistanceM - 0.005);
    expect(final.kind).toBe('glide');
    expect(Math.abs(final.durationS - (trajectory.cyclePoints - trajectory.climbPoints - 1))).toBeLessThanOrEqual(BOUNDARY_TOLERANCE_S);
  });
});

/* ── Синтетика ──────────────────────────────────────────────────────────── */

const walkUp: Leg = { seconds: 300, turnDegS: 0, climbMs: 0.3, speedMs: 1.3 };
const walkAway: Leg = { seconds: 120, turnDegS: 0, climbMs: 0, speedMs: 1 };
const glideLeg: Leg = { seconds: 120, turnDegS: 0, climbMs: -1 };
const thermalLeg: Leg = { seconds: 100, turnDegS: 18, climbMs: 2 };

describe('detectGlides — переходы от взлёта до посадки', () => {
  it('старт → глайд → термик → глайд → термик → финальный глайд → посадка: три глайда', () => {
    const { thermals, range, glides } = analyse(
      flight([walkUp, glideLeg, thermalLeg, glideLeg, thermalLeg, { seconds: 180, turnDegS: 0, climbMs: -1.2 }, walkAway]),
    );
    expect(thermals).toHaveLength(2);
    expect(glides).toHaveLength(3);
    const [first, second] = thermals;
    // Первый — от взлёта, не от начала записи: подъём пешком не глайд.
    expect(glides[0]?.startIndex).toBe(range.takeoff);
    expect(Math.abs(range.takeoff - walkUp.seconds)).toBeLessThanOrEqual(BOUNDARY_TOLERANCE_S);
    expect(glides[0]?.endIndex).toBe(first?.startIndex);
    expect(glides[1]?.startIndex).toBe(first?.endIndex);
    expect(glides[1]?.endIndex).toBe(second?.startIndex);
    expect(glides[2]?.startIndex).toBe(second?.endIndex);
    // Последний — до посадки, не до конца записи: уход с посадки пешком не глайд.
    expect(glides[2]?.endIndex).toBe(range.landing);
    glides.forEach(expectConsistent);
  });

  it('переход короче 30 с — не глайд', () => {
    // 20 с со снижением между двумя термиками — разрыв больше 15 с, это два термика.
    const { thermals, glides } = analyse(
      flight([glideLeg, thermalLeg, { seconds: 20, turnDegS: 0, climbMs: -1 }, thermalLeg, glideLeg]),
    );
    expect(thermals).toHaveLength(2);
    expect(glides).toHaveLength(2);
    expect(glides[0]?.endIndex).toBe(thermals[0]?.startIndex);
    expect(glides[1]?.startIndex).toBe(thermals[1]?.endIndex);
  });

  it('круги поиска на переходе, не ставшие термиком, — тот же глайд, только менее прямой', () => {
    const searching: Leg = { seconds: 40, turnDegS: 18, climbMs: -1.5 };
    const straight = analyse(flight([glideLeg, glideLeg])).glides;
    const withSearch = analyse(flight([glideLeg, searching, glideLeg])).glides;
    expect(withSearch).toHaveLength(1);
    expect(withSearch[0]?.headingConsistency).toBeLessThan(0.95);
    expect(straight[0]?.headingConsistency).toBeCloseTo(1, 9);
  });

  it('прямо на север 300 с, 10 м/с, снижение 1 м/с — цифры точно', () => {
    const [only, ...rest] = analyse(flight([{ seconds: 300, turnDegS: 0, climbMs: -1 }])).glides;
    expect(rest).toEqual([]);
    expect(only).toBeDefined();
    if (!only) return;
    expect(only.startIndex).toBe(0);
    expect(only.endIndex).toBe(300);
    expect(only.durationS).toBe(300);
    expect(only.distanceM).toBeCloseTo(3000 * SPHERE_SCALE, 6);
    expect(only.altLossM).toBeCloseTo(300, 9);
    expect(only.glideRatio).toBeCloseTo(10 * SPHERE_SCALE, 6);
    expect(only.avgGroundSpeedMs).toBeCloseTo(10 * SPHERE_SCALE, 6);
    expect(only.avgVzMs).toBeCloseTo(-1, 9);
    expect(only.headingDeg).toBeCloseTo(0, 9);
    expect(only.headingConsistency).toBeCloseTo(1, 9);
    expect(only.kind).toBe('glide');
  });

  it('потеря меньше 50 м — dynamic, качества нет; набор по прямой — тоже dynamic', () => {
    const [sinkingSlowly] = analyse(flight([{ seconds: 120, turnDegS: 0, climbMs: -0.2 }])).glides;
    expect(sinkingSlowly?.kind).toBe('dynamic');
    expect(sinkingSlowly?.glideRatio).toBeNull();
    const [ridge] = analyse(flight([{ seconds: 120, turnDegS: 0, climbMs: 1 }])).glides;
    expect(ridge?.kind).toBe('dynamic');
    expect(ridge?.glideRatio).toBeNull();
    expect(ridge?.altLossM).toBeLessThan(0);
    expect(ridge?.avgVzMs).toBeGreaterThan(0);
  });

  it('качество выше 60 клипуется: 6 км на 60 м потери — 60, а не 100', () => {
    const [far] = analyse(flight([{ seconds: 600, turnDegS: 0, climbMs: -0.1 }])).glides;
    expect(far?.kind).toBe('glide');
    expect(far?.glideRatio).toBe(GLIDE.maxGlideRatio);
  });

  it('разрыв записи внутри глайда — путь через него не набегает', () => {
    const full = flight([{ seconds: 300, turnDegS: 0, climbMs: -1 }]);
    // Точек 100…159 нет: разрыв 61 с, дольше порога интерполяции (CLEAN.maxInterpolationGapS).
    const keep = Array.from({ length: full.t.length }, (_, i) => i).filter((i) => i < 100 || i >= 160);
    const pick = (column: Float64Array): Float64Array => Float64Array.from(keep, (i) => column[i] ?? Number.NaN);
    const gapped = {
      t: pick(full.t),
      lat: pick(full.lat),
      lon: pick(full.lon),
      altitude: pick(full.altitude),
      heading: pick(full.heading),
      vSpeed: pick(full.vSpeed),
      groundSpeed: pick(full.groundSpeed),
    };
    expect((160 - 99) * 1000).toBeGreaterThan(CLEAN.maxInterpolationGapS * 1000);
    const [only] = analyse(gapped).glides;
    expect(only?.durationS).toBe(300);
    expect(only?.distanceM).toBeCloseTo((99 + 140) * 10 * SPHERE_SCALE, 6);
  });

  it('полёта нет — глайдов нет; пустой вход — пустой выход', () => {
    expect(analyse(flight([{ seconds: 200, turnDegS: 0, climbMs: 0, speedMs: 1 }])).glides).toEqual([]);
    const empty = new Float64Array();
    const columns: GlideColumns = { t: empty, lat: empty, lon: empty, altitude: empty };
    expect(detectGlides(columns, [], { takeoff: -1, landing: -1 })).toEqual([]);
  });
});

/* ── Реальный трек (fixtures/real-wind-thermals.igc) ────────────────────── */

describe('detectGlides на реальном треке — переходы между найденными термиками', () => {
  const { thermals, range, glides } = analyseFixture('real-wind-thermals.igc');
  /** Концы переходов: взлёт, термики по порядку, посадка. */
  const edges = [range.takeoff, ...thermals.flatMap((thermal) => [thermal.startIndex, thermal.endIndex]), range.landing];
  const transitions = Array.from({ length: edges.length / 2 }, (_, k) => ({ start: edges[2 * k] ?? 0, end: edges[2 * k + 1] ?? 0 }));

  it('каждый переход не короче 30 с — ровно один глайд с его границами, остальные — нет', () => {
    const expected = transitions.filter(({ start, end }) => end - start >= GLIDE.minDurationS);
    expect(glides.map(({ startIndex, endIndex }) => ({ start: startIndex, end: endIndex }))).toEqual(expected);
    // Между 29 термиками переходов много: проверка не пустая.
    expect(glides.length).toBeGreaterThan(20);
  });

  it('цифры согласованы; качество обычного глайда — как у параплана в ветре', () => {
    glides.forEach(expectConsistent);
    const ratios = glides.flatMap((glide) => (glide.glideRatio === null ? [] : [glide.glideRatio]));
    // Параплан — 7–10 в штиль; в ветре ~35 км/ч по ветру больше, против — меньше.
    expect(median(ratios)).toBeGreaterThan(4);
    expect(median(ratios)).toBeLessThan(15);
  });
});
