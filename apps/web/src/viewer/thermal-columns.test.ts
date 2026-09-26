import { describe, expect, it } from 'vitest';

import { COLUMN_ALPHA, currentColumn, THERMAL_COLUMN, thermalColumns, type ColumnTrack } from './thermal-columns';
import { varioRgb } from './vario-palette';

/**
 * Колонны термиков (ТЗ §7.2, задача 2.7): ось — от середины первых секунд
 * термика к середине последних (снос ветром), высоты — по треку сцены
 * (откалиброванному по земле), радиус — средний круг, цвет — палитра варио.
 */

const START_MS = Date.UTC(2026, 6, 15, 10);
const M_PER_DEG_LAT = 111_320;

/**
 * Спираль на 1 Гц: круг радиусом 30 м за 20 с, центр сносит на восток 2 м/с,
 * набор 1.5 м/с; до и после — по 60 с прямо.
 */
function spiralTrack(): ColumnTrack {
  const t: number[] = [];
  const lat: number[] = [];
  const lon: number[] = [];
  const alt: number[] = [];
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((43.2 * Math.PI) / 180);
  for (let s = 0; s <= 360; s++) {
    const inThermal = s >= 60 && s <= 300;
    const k = Math.min(Math.max(s - 60, 0), 240);
    const a = (2 * Math.PI * k) / 20;
    const east = 2 * k + (inThermal ? 30 * Math.sin(a) : 0) + (s > 300 ? (s - 300) * 10 : 0) - (s < 60 ? (60 - s) * 10 : 0);
    const north = inThermal ? 30 * Math.cos(a) - 30 : 0;
    t.push(START_MS + s * 1000);
    lat.push(43.2 + north / M_PER_DEG_LAT);
    lon.push(76.9 + east / mPerDegLon);
    alt.push(1500 + 1.5 * k);
  }
  return { t: Float64Array.from(t), lat: Float64Array.from(lat), lon: Float64Array.from(lon), alt: Float64Array.from(alt) };
}

const thermal = { startMs: START_MS + 60_000, endMs: START_MS + 300_000, avgClimbMs: 1.5, avgRadiusM: 30 };

describe('thermalColumns', () => {
  const track = spiralTrack();
  const [column] = thermalColumns(track, [thermal]);
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((43.2 * Math.PI) / 180);

  it('высоты — вход и выход по треку сцены: высота колонны = набор', () => {
    expect(column?.bottom.alt).toBe(1500);
    expect(column?.top.alt).toBe(1500 + 1.5 * 240);
  });

  it('ось — центры кругов в начале и конце, а не точки входа и выхода', () => {
    // За окно центра (один круг, 20 с) пилот обходит круг целиком — среднее
    // координат ложится в центр круга, сдвинутый сносом на середину окна.
    const window = THERMAL_COLUMN.centerWindowS;
    const bottomEastM = ((column?.bottom.lon ?? 0) - 76.9) * mPerDegLon;
    const topEastM = ((column?.top.lon ?? 0) - 76.9) * mPerDegLon;
    expect(Math.abs(bottomEastM - 2 * (window / 2))).toBeLessThan(2);
    expect(Math.abs(topEastM - 2 * (240 - window / 2))).toBeLessThan(2);
    // Север: центр круга — на −30 м от начала, как у спирали.
    expect(Math.abs(((column?.bottom.lat ?? 0) - 43.2) * M_PER_DEG_LAT + 30)).toBeLessThan(2);
  });

  it('радиус — средний круг термика; цвет — палитра варио по среднему набору', () => {
    expect(column?.radiusM).toBe(30);
    expect(column?.rgb).toEqual(varioRgb(1.5));
  });

  it('короткий термик — окно центра не больше половины термика', () => {
    const short = { ...thermal, endMs: thermal.startMs + 16_000 };
    const [c] = thermalColumns(track, [short]);
    expect(c).toBeDefined();
    expect(c?.top.alt).toBeGreaterThan(c?.bottom.alt ?? Infinity);
  });

  it('термик вне трека (время не попадает в запись) — колонны нет', () => {
    const outside = { ...thermal, startMs: START_MS - 600_000, endMs: START_MS - 300_000 };
    expect(thermalColumns(track, [outside])).toEqual([]);
  });
});

describe('currentColumn и прозрачность', () => {
  const columns = thermalColumns(spiralTrack(), [thermal]);

  it('текущая колонна — та, в чьём времени пилот; вне термиков — ни одной', () => {
    expect(currentColumn(columns, thermal.startMs + 1000)).toBe(0);
    expect(currentColumn(columns, thermal.startMs - 1000)).toBeNull();
  });

  it('текущая плотнее остальных', () => {
    expect(COLUMN_ALPHA.current).toBeGreaterThan(COLUMN_ALPHA.other);
  });
});
