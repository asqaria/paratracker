import { CINEMA, TIME } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { autoEdit, type AutoEditInput, type CutScene } from './auto-edit.js';
import { cleanAndDerive } from './clean-derive.js';
import { analyseFlight } from './flight-analysis.js';
import { flightRange } from './flight-range.js';
import { parseFixture } from './testing/tracks.js';

/**
 * Автомонтаж (задача 4.1, ТЗ §7.6) на реальном треке с термиками
 * (fixtures/real-wind-thermals.igc). Эталоны точные и выводятся из входа без
 * алгоритма: взлёт — первая минута после точки взлёта, посадка — последняя,
 * лучший термик — термик с наибольшим набором.
 */

const derived = cleanAndDerive(parseFixture('real-wind-thermals.igc'));
const p = derived.points;
const range = flightRange(p.t, p.groundSpeed);
const analysis = analyseFlight(derived, 'paraglider');
if (!analysis) throw new Error('analysis expected');
const input: AutoEditInput = { t: p.t, alt: p.altitude, range, thermals: analysis.thermals, glides: analysis.glides };
const takeoffMs = p.t[range.takeoff] ?? Number.NaN;
const landingMs = p.t[range.landing] ?? Number.NaN;
const ms = (s: number) => s * TIME.msPerSecond;

const byKind = (scenes: CutScene[], kind: CutScene['kind']) => scenes.find((s) => s.kind === kind);

describe('autoEdit на реальном треке', () => {
  const scenes = autoEdit(input);

  it('взлёт — первая минута в воздухе, низкий орбит', () => {
    expect(byKind(scenes, 'takeoff')).toMatchObject({
      camera: 'lowOrbit',
      fromMs: takeoffMs,
      toMs: takeoffMs + ms(CINEMA.takeoffWindowS),
      durationS: CINEMA.sceneS.takeoff,
    });
  });

  it('посадка — последняя минута, chase→top', () => {
    expect(byKind(scenes, 'landing')).toMatchObject({
      camera: 'chaseToTop',
      fromMs: landingMs - ms(CINEMA.landingWindowS),
      toMs: landingMs,
      durationS: CINEMA.sceneS.landing,
    });
  });

  it('лучший термик — с наибольшим набором, орбитальный подъём во весь термик', () => {
    const best = [...analysis.thermals].sort((a, b) => b.gainM - a.gainM)[0];
    if (!best) throw new Error('thermal expected');
    expect(byKind(scenes, 'bestThermal')).toMatchObject({
      camera: 'orbitClimb',
      fromMs: best.startTimeMs,
      toMs: best.endTimeMs,
      durationS: CINEMA.sceneS.bestThermal,
    });
  });

  it('самый длинный глайд — chase внутри этого глайда (подрезан по взлёту и посадке)', () => {
    const longest = analysis.glides.filter((g) => g.kind === 'glide').sort((a, b) => b.distanceM - a.distanceM)[0];
    const scene = byKind(scenes, 'longestGlide');
    if (!longest || !scene) throw new Error('glide scene expected');
    expect(scene.camera).toBe('chase');
    expect(scene.fromMs).toBeGreaterThanOrEqual(longest.startTimeMs);
    expect(scene.toMs).toBeLessThanOrEqual(longest.endTimeMs);
  });

  it('сцены по порядку полёта, не пересекаются, внутри полёта; ускорение — окно / экран', () => {
    expect(scenes.length).toBeGreaterThanOrEqual(3);
    scenes.forEach((s, k) => {
      expect(s.fromMs).toBeGreaterThanOrEqual(takeoffMs);
      expect(s.toMs).toBeLessThanOrEqual(landingMs);
      expect(s.toMs - s.fromMs).toBeGreaterThanOrEqual(ms(CINEMA.minWindowS));
      expect(s.durationS).toBe(CINEMA.sceneS[s.kind]);
      expect(s.timeScale).toBe((s.toMs - s.fromMs) / TIME.msPerSecond / s.durationS);
      const prev = scenes[k - 1];
      if (prev) expect(s.fromMs).toBeGreaterThanOrEqual(prev.toMs);
    });
    expect(scenes[0]?.kind).toBe('takeoff');
    expect(scenes.at(-1)?.kind).toBe('landing');
  });

  it('детерминирован: тот же вход — тот же монтаж', () => {
    expect(autoEdit(input)).toEqual(scenes);
  });
});

/** Синтетика: точка в секунду, высота задаётся функцией от секунды полёта. */
function synthetic(durationS: number, alt: (s: number) => number): Pick<AutoEditInput, 't' | 'alt' | 'range'> {
  return {
    t: Float64Array.from({ length: durationS + 1 }, (_, s) => ms(s)),
    alt: Float64Array.from({ length: durationS + 1 }, (_, s) => alt(s)),
    range: { takeoff: 0, landing: durationS },
  };
}

describe('autoEdit — краевые случаи', () => {
  it('первый термик и есть лучший — одна сцена термика, не две', () => {
    const base = synthetic(1800, () => 1000);
    const thermal = { startTimeMs: ms(300), endTimeMs: ms(600), gainM: 300 };
    const kinds = autoEdit({ ...base, thermals: [thermal], glides: [] }).map((s) => s.kind);
    expect(kinds.filter((k) => k === 'bestThermal' || k === 'firstThermal')).toEqual(['bestThermal']);
  });

  it('первый термик раньше лучшего — обе сцены по порядку', () => {
    const base = synthetic(3600, () => 1000);
    const first = { startTimeMs: ms(300), endTimeMs: ms(500), gainM: 150 };
    const best = { startTimeMs: ms(1500), endTimeMs: ms(1900), gainM: 600 };
    const kinds = autoEdit({ ...base, thermals: [first, best], glides: [] }).map((s) => s.kind);
    expect(kinds.indexOf('firstThermal')).toBeGreaterThan(-1);
    expect(kinds.indexOf('firstThermal')).toBeLessThan(kinds.indexOf('bestThermal'));
  });

  it('рекорд высоты внутри лучшего термика — не повторяется отдельной сценой', () => {
    const base = synthetic(3600, (s) => 1000 + (s >= 1500 && s <= 1900 ? s - 1500 : 0));
    const best = { startTimeMs: ms(1500), endTimeMs: ms(1900), gainM: 400 };
    const kinds = autoEdit({ ...base, thermals: [best], glides: [] }).map((s) => s.kind);
    expect(kinds).not.toContain('maxAltitude');
  });

  it('рекорд высоты вне термиков — широкий пролёт, вершина посередине', () => {
    const base = synthetic(3600, (s) => 2000 - Math.abs(s - 2000));
    const scene = autoEdit({ ...base, thermals: [], glides: [] }).find((s) => s.kind === 'maxAltitude');
    expect(scene).toMatchObject({
      camera: 'wideFlyby',
      fromMs: ms(2000 - CINEMA.maxAltitudeWindowS / 2),
      toMs: ms(2000 + CINEMA.maxAltitudeWindowS / 2),
    });
  });

  it('сдувание с горы без термиков: взлёт, заход и посадка', () => {
    const kinds = autoEdit({ ...synthetic(600, (s) => 2000 - s), thermals: [], glides: [] }).map((s) => s.kind);
    expect(kinds).toEqual(['takeoff', 'finalApproach', 'landing']);
  });

  it('полёт короче двух минут — взлёт и посадка делят его пополам', () => {
    const scenes = autoEdit({ ...synthetic(80, () => 1000), thermals: [], glides: [] });
    expect(scenes.map((s) => [s.kind, s.fromMs, s.toMs])).toEqual([
      ['takeoff', 0, ms(40)],
      ['landing', ms(40), ms(80)],
    ]);
  });

  it('пустой полёт (взлёт = посадка) — фильма нет', () => {
    const base = synthetic(10, () => 1000);
    expect(autoEdit({ ...base, range: { takeoff: 5, landing: 5 }, thermals: [], glides: [] })).toEqual([]);
  });
});
