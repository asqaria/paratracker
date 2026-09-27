import type { CutScene } from '@skyline/analysis';
import { describe, expect, it } from 'vitest';

import { arcPoint, easeInOut, FILM, filmFrameAt, filmTimeline, scenePose } from './film';

const scene = (kind: CutScene['kind'], camera: CutScene['camera'], fromS: number, toS: number, durationS: number): CutScene => ({
  kind,
  camera,
  fromMs: fromS * 1000,
  toMs: toS * 1000,
  durationS,
  timeScale: (toS - fromS) / durationS,
});

const scenes = [
  scene('takeoff', 'lowOrbit', 0, 60, 3),
  scene('bestThermal', 'orbitClimb', 600, 1200, 4),
  scene('landing', 'chaseToTop', 3540, 3600, 3),
];

describe('filmTimeline — хронометраж', () => {
  const film = filmTimeline(scenes);

  it('сцены подряд с перелётами между ними; длина — сцены плюс перелёты', () => {
    const expected = [
      [0, 3],
      [3 + FILM.transitionS, 7 + FILM.transitionS],
      [7 + 2 * FILM.transitionS, 10 + 2 * FILM.transitionS],
    ];
    film.shots.forEach((shot, k) => {
      expect(shot.startS).toBeCloseTo(expected[k]?.[0] ?? Number.NaN, 9);
      expect(shot.endS).toBeCloseTo(expected[k]?.[1] ?? Number.NaN, 9);
    });
    expect(film.totalS).toBeCloseTo(10 + 2 * FILM.transitionS, 9);
  });

  it('пустой монтаж — пустой фильм', () => {
    expect(filmTimeline([])).toEqual({ shots: [], totalS: 0 });
  });
});

describe('filmFrameAt — кадр по времени экрана', () => {
  const film = filmTimeline(scenes);

  it('внутри сцены время полёта идёт линейно по окну', () => {
    const frame = filmFrameAt(film, 1.5);
    expect(frame).toMatchObject({ kind: 'scene', index: 0, u: 0.5, flightMs: 30_000 });
  });

  it('в перелёте время полёта проматывается от конца сцены к началу следующей', () => {
    const start = filmFrameAt(film, 3);
    const end = filmFrameAt(film, 3 + FILM.transitionS - 1e-9);
    expect(start).toMatchObject({ kind: 'transition', index: 0, u: 0, flightMs: 60_000 });
    expect(end?.kind).toBe('transition');
    expect(end?.flightMs).toBeCloseTo(600_000, 3);
  });

  it('до начала — первый кадр, после конца — null (фильм кончился)', () => {
    expect(filmFrameAt(film, -1)).toMatchObject({ kind: 'scene', index: 0, u: 0, flightMs: 0 });
    expect(filmFrameAt(film, film.totalS)).toBeNull();
  });
});

describe('easeInOut', () => {
  it('концы на месте, симметрично, монотонно, мягкий старт', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 9);
    expect(easeInOut(0.2) + easeInOut(0.8)).toBeCloseTo(1, 9);
    expect(easeInOut(0.05)).toBeLessThan(0.05);
    let previous = 0;
    for (let k = 1; k <= 100; k++) {
      const value = easeInOut(k / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('arcPoint — перелёт по Безье с подъёмом', () => {
  const a = { lat: 43, lon: 77, alt: 1000 };
  const b = { lat: 43, lon: 77.1, alt: 2000 };

  it('концы — точки сцен; посередине — выше прямой на половину подъёма', () => {
    expect(arcPoint(a, b, 0, 400)).toEqual(a);
    expect(arcPoint(a, b, 1, 400)).toEqual(b);
    const mid = arcPoint(a, b, 0.5, 400);
    expect(mid.lon).toBeCloseTo(77.05, 9);
    expect(mid.alt).toBeCloseTo(1500 + 200, 9);
  });
});

describe('scenePose — камеры сцен', () => {
  it('низкий орбит — близко, облёт от курса', () => {
    const start = scenePose('lowOrbit', 0, 90, 90);
    const end = scenePose('lowOrbit', 1, 90, 90);
    expect(start.rangeM).toBe(FILM.lowOrbit.rangeM);
    expect(start.headingDeg).toBe(90);
    expect(end.headingDeg).toBe(90 + FILM.lowOrbit.sweepDeg);
  });

  it('орбитальный подъём — полкруга, взгляд опускается', () => {
    const start = scenePose('orbitClimb', 0, 0, 0);
    const end = scenePose('orbitClimb', 1, 0, 0);
    expect(end.headingDeg - start.headingDeg).toBe(FILM.orbitClimb.sweepDeg);
    expect(end.pitchDeg).toBeLessThan(start.pitchDeg);
  });

  it('chase — за пилотом по курсу', () => {
    expect(scenePose('chase', 0.3, 200, 10)).toEqual({ headingDeg: 200, pitchDeg: FILM.chase.pitchDeg, rangeM: FILM.chase.rangeM });
  });

  it('chase→top — от chase к виду сверху, издалека', () => {
    const start = scenePose('chaseToTop', 0, 45, 45);
    const end = scenePose('chaseToTop', 1, 45, 45);
    expect(start.pitchDeg).toBe(FILM.chase.pitchDeg);
    expect(start.rangeM).toBe(FILM.chase.rangeM);
    expect(end.pitchDeg).toBe(FILM.top.pitchDeg);
    expect(end.rangeM).toBe(FILM.top.rangeM);
  });

  it('широкий пролёт — далеко, медленный облёт', () => {
    const pose = scenePose('wideFlyby', 0.5, 0, 0);
    expect(pose.rangeM).toBe(FILM.wideFlyby.rangeM);
    expect(pose.headingDeg).toBe(FILM.wideFlyby.sweepDeg / 2);
  });
});
