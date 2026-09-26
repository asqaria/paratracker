import { describe, expect, it } from 'vitest';

import { TRACK_FLAGS } from '@skyline/core';

import { CURTAIN, curtainInMode, curtainOnByDefault, curtainPieces, curtainSamples, curtainSegmentsShown, pieceProgress } from './curtain';

/**
 * «Занавес» под треком (ТЗ §7.2, задача 2.8): стена по прореженным точкам
 * участка полёта, сегментами — чтобы в режиме «Пройденный» расти за пилотом.
 */

const START_MS = Date.UTC(2026, 6, 15, 10);
/** Время на 1 Гц: n точек. */
const times = (n: number): Float64Array => Float64Array.from({ length: n }, (_, i) => START_MS + i * 1000);

describe('curtainSamples', () => {
  it('каждая точка участка полёта — те же вершины, что у линии и тени; ходьба — без занавеса', () => {
    const samples = curtainSamples({ takeoff: 120, landing: 130 });
    expect(samples).toEqual([120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130]);
  });

  it('полёта нет (takeoff ≥ landing) — занавеса нет', () => {
    expect(curtainSamples({ takeoff: 99, landing: 99 })).toEqual([]);
  });
});

describe('curtainPieces', () => {
  const lat = Float64Array.from({ length: 100 }, (_, i) => 43.2 + i * 1e-4);
  const lon = Float64Array.from({ length: 100 }, () => 76.9);

  it('сегменты между термиками — отдельные стены, по порядку', () => {
    const samples = [0, 10, 20, 30, 40, 50, 60];
    const shown = [true, true, false, false, true, true];
    expect(curtainPieces(samples, shown, lat, lon)).toEqual([
      [0, 10, 20],
      [40, 50, 60],
    ]);
  });

  it('совпадающие соседние точки выброшены: WallGeometry выбросила бы их сама и сбила номера', () => {
    const still = Float64Array.from(lat);
    still[20] = still[10] ?? 0; // пилот стоит против ветра: точка та же
    expect(curtainPieces([0, 10, 20, 30], [true, true, true], still, lon)).toEqual([[0, 10, 30]]);
  });

  it('стена из одной точки — не стена', () => {
    expect(curtainPieces([0, 10, 20], [false, false], lat, lon)).toEqual([]);
  });
});

describe('pieceProgress', () => {
  const t = times(100);
  const piece = [10, 20, 30];

  it('доля s стены — по номеру точки и доле времени внутри отрезка: край у пилота', () => {
    expect(pieceProgress(t, piece, START_MS + 5_000)).toBe(0);
    expect(pieceProgress(t, piece, START_MS + 10_000)).toBe(0);
    expect(pieceProgress(t, piece, START_MS + 15_000)).toBeCloseTo(0.25, 9);
    expect(pieceProgress(t, piece, START_MS + 20_000)).toBeCloseTo(0.5, 9);
    expect(pieceProgress(t, piece, START_MS + 27_500)).toBeCloseTo(0.875, 9);
    expect(pieceProgress(t, piece, START_MS + 40_000)).toBe(1);
  });

  it('плавно: между кадрами доля растёт непрерывно, без ступенек', () => {
    const at = (ms: number): number => pieceProgress(t, piece, START_MS + ms);
    for (let ms = 10_000; ms < 30_000; ms += 250) {
      expect(at(ms + 250) - at(ms)).toBeCloseTo(250 / 20_000, 9);
    }
  });
});

describe('curtainSegmentsShown', () => {
  it('в термике занавеса нет: спираль, свёрнутая в стену, — белая гребёнка; термик отмечен колонной', () => {
    const flags = new Uint8Array(100);
    for (let i = 30; i <= 60; i++) flags[i] = TRACK_FLAGS.thermal;
    const samples = [0, 10, 20, 30, 40, 50, 60, 70, 80];
    // В термике хотя бы один конец — скрыт: иначе вход и выход стояли одинокими листами.
    expect(curtainSegmentsShown(samples, flags)).toEqual([true, true, false, false, false, false, false, true]);
  });

  it('другие флаги точки (разрыв) термиком не считаются', () => {
    const flags = new Uint8Array(30).fill(TRACK_FLAGS.gap);
    expect(curtainSegmentsShown([0, 10, 20], flags)).toEqual([true, true]);
  });
});

describe('curtainInMode', () => {
  it('только Side и Free: сбоку и со стороны стена показывает высоту, из Chase видна с торца', () => {
    expect(curtainInMode('side')).toBe(true);
    expect(curtainInMode('free')).toBe(true);
    for (const mode of ['chase', 'cockpit', 'top'] as const) expect(curtainInMode(mode)).toBe(false);
  });
});

describe('CURTAIN', () => {
  it('у земли стена не растворяется, а кромка у рельефа плотнее — видно, где стена встала на землю', () => {
    expect(CURTAIN.bottomAlpha).toBeGreaterThan(0);
    expect(CURTAIN.groundEdge.alpha).toBeGreaterThan(CURTAIN.topAlpha);
  });
});

describe('curtainOnByDefault', () => {
  it('на десктопе включён, на телефоне выключен (ТЗ §5.3)', () => {
    expect(curtainOnByDefault(false)).toBe(true);
    expect(curtainOnByDefault(true)).toBe(false);
  });
});
