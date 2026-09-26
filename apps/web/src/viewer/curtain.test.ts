import { describe, expect, it } from 'vitest';

import { TRACK_FLAGS } from '@skyline/core';

import { CURTAIN, curtainOnByDefault, curtainSamples, curtainSegmentsShown, flownSegments } from './curtain';

/**
 * «Занавес» под треком (ТЗ §7.2, задача 2.8): стена по прореженным точкам
 * участка полёта, сегментами — чтобы в режиме «Пройденный» расти за пилотом.
 */

const START_MS = Date.UTC(2026, 6, 15, 10);
/** Время на 1 Гц: n точек. */
const times = (n: number): Float64Array => Float64Array.from({ length: n }, (_, i) => START_MS + i * 1000);

describe('curtainSamples', () => {
  it('только участок полёта: от взлёта до посадки, ходьба — без занавеса', () => {
    const samples = curtainSamples(times(1000), { takeoff: 120, landing: 900 });
    expect(samples[0]).toBe(120);
    expect(samples.at(-1)).toBe(900);
  });

  it('точка раз в CURTAIN.sampleStepS секунд; посадка — всегда последней', () => {
    const samples = curtainSamples(times(1000), { takeoff: 100, landing: 903 });
    const steps = samples.slice(1).map((index, k) => index - (samples[k] ?? 0));
    expect(steps.slice(0, -1).every((step) => step === CURTAIN.sampleStepS)).toBe(true);
    expect(steps.at(-1)).toBeLessThanOrEqual(CURTAIN.sampleStepS);
  });

  it('разрыв записи — шаг по времени, а не по номеру точки', () => {
    // 60 точек, потом разрыв на 5 минут, потом ещё 60.
    const t = Float64Array.from([...times(60), ...Array.from({ length: 60 }, (_, i) => START_MS + 360_000 + i * 1000)]);
    const samples = curtainSamples(t, { takeoff: 0, landing: 119 });
    const gapCrossing = samples.findIndex((index) => index >= 60);
    expect(samples[gapCrossing]).toBe(60);
  });

  it('полёта нет (takeoff ≥ landing) — занавеса нет', () => {
    expect(curtainSamples(times(100), { takeoff: 99, landing: 99 })).toEqual([]);
  });
});

describe('flownSegments', () => {
  const t = times(1000);
  const samples = curtainSamples(t, { takeoff: 0, landing: 999 });

  it('сегмент показан, когда пилот прошёл его конец', () => {
    expect(flownSegments(t, samples, START_MS)).toBe(0);
    expect(flownSegments(t, samples, START_MS + CURTAIN.sampleStepS * 1000)).toBe(1);
    expect(flownSegments(t, samples, START_MS + (CURTAIN.sampleStepS * 1000 * 5) / 2)).toBe(2);
    expect(flownSegments(t, samples, START_MS + 999_000)).toBe(samples.length - 1);
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

describe('curtainOnByDefault', () => {
  it('на десктопе включён, на телефоне выключен (ТЗ §5.3)', () => {
    expect(curtainOnByDefault(false)).toBe(true);
    expect(curtainOnByDefault(true)).toBe(false);
  });
});
