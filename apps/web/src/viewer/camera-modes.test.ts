import { describe, expect, it } from 'vitest';

import {
  CAMERA_HOTKEY_ORDER,
  CAMERA_MODES,
  CAMERA_POSES,
  CHASE_SMOOTHING_TAU_S,
  DEFAULT_CAMERA_MODE,
  frameSeconds,
  MAX_FRAME_S,
  nearestHeading,
  shortestTurn,
  springHeading,
} from './camera-modes';

describe('режимы камеры', () => {
  it('пять режимов, цифры 1–5 в порядке ТЗ §7.5: Side — сразу за Chase', () => {
    expect(CAMERA_MODES).toEqual(['chase', 'side', 'free', 'cockpit', 'top']);
    expect(CAMERA_HOTKEY_ORDER).toEqual(['chase', 'side', 'free', 'cockpit', 'top']);
    expect(CAMERA_MODES).toContain(DEFAULT_CAMERA_MODE);
  });

  it('free — режим без слежения, остальные с позой', () => {
    expect(CAMERA_POSES.free).toBeNull();
    expect(CAMERA_POSES.chase).toMatchObject({ headingDeg: null, pitchDeg: -14, rangeM: 90 });
    expect(CAMERA_POSES.cockpit?.rangeM).toBeLessThan(CAMERA_POSES.chase?.rangeM ?? 0);
    expect(CAMERA_POSES.top).toMatchObject({ headingDeg: 0 });
  });

  it('Side — сбоку от курса, почти горизонтально, дальше Chase: виден профиль полёта', () => {
    const side = CAMERA_POSES.side;
    expect(side).toMatchObject({ headingDeg: null, courseOffsetDeg: -90 });
    expect(side?.rangeM).toBeGreaterThan(CAMERA_POSES.chase?.rangeM ?? Number.POSITIVE_INFINITY);
    expect(side?.pitchDeg).toBeGreaterThan(CAMERA_POSES.chase?.pitchDeg ?? 0);
  });
});

describe('frameSeconds — шаг сглаживания в секундах экрана', () => {
  it('разница между кадрами, мс → с', () => {
    expect(frameSeconds(1000, 1016)).toBeCloseTo(0.016, 9);
  });

  it('первый кадр и часы назад — ноль, а не скачок', () => {
    expect(frameSeconds(null, 1000)).toBe(0);
    expect(frameSeconds(1000, 900)).toBe(0);
  });

  it('вкладка была в фоне — шаг ограничен, камера не прыгает сразу к цели', () => {
    expect(frameSeconds(0, 60_000)).toBe(MAX_FRAME_S);
  });
});

describe('shortestTurn', () => {
  it.each([
    [10, 20, 10],
    [350, 10, 20],
    [10, 350, -20],
    [0, 180, 180],
    [0, 181, -179],
  ])('от %i° к %i° — %i°', (from, to, expected) => {
    expect(shortestTurn(from, to)).toBeCloseTo(expected, 9);
  });
});

describe('nearestHeading — курс для камеры, когда пилот стоит', () => {
  const nan = Number.NaN;

  it('курс в точке есть — он и берётся', () => {
    expect(nearestHeading(Float64Array.from([10, 20, 30]), 1)).toBe(20);
  });

  it('стоянка посреди полёта — последний известный курс до неё', () => {
    expect(nearestHeading(Float64Array.from([10, 20, nan, nan, 50]), 3)).toBe(20);
  });

  it('стоянка на старте — первый известный курс после неё', () => {
    // Реальный трек: первые 14 точек без курса, камера Chase падала с NaN.
    expect(nearestHeading(Float64Array.from([nan, nan, nan, 75, 80]), 0)).toBe(75);
  });

  it('курса нет во всём треке — север, а не NaN', () => {
    expect(nearestHeading(Float64Array.from([nan, nan]), 1)).toBe(0);
    expect(nearestHeading(new Float64Array(0), 0)).toBe(0);
  });
});

describe('springHeading — поворот камеры без рывка на старте', () => {
  const FRAME_S = 1 / 60;
  const settle = (from: number, to: number, seconds: number) => {
    let state = springHeading(null, from, FRAME_S);
    const rates: number[] = [];
    for (let f = 0; f < seconds * 60; f++) {
      state = springHeading(state, to, FRAME_S);
      rates.push(state.rateDegS);
    }
    return { state, rates };
  };

  it('первый кадр — сразу цель, без вращения', () => {
    expect(springHeading(null, 123, FRAME_S)).toEqual({ headingDeg: 123, rateDegS: 0 });
  });

  it('скачок цели на 90°: скорость поворота растёт плавно, а не прыжком за кадр', () => {
    const { rates } = settle(0, 90, 1);
    // Экспоненциальное сглаживание за первый кадр сразу крутило бы на 90/τ = 45 °/с.
    expect(Math.abs(rates[0] ?? 0)).toBeLessThan(2);
    const jumps = rates.slice(1).map((rate, i) => Math.abs(rate - (rates[i] ?? rate)));
    expect(Math.max(...jumps)).toBeLessThan(2);
  });

  it('доходит до цели за несколько τ и не проскакивает её', () => {
    const { state, rates } = settle(0, 90, 4 * CHASE_SMOOTHING_TAU_S);
    expect(state.headingDeg).toBeCloseTo(90, 0);
    expect(Math.min(...rates)).toBeGreaterThanOrEqual(-1e-9);
  });

  it('идёт коротким путём через 360°', () => {
    const { state } = settle(350, 10, 4 * CHASE_SMOOTHING_TAU_S);
    expect(shortestTurn(10, state.headingDeg)).toBeCloseTo(0, 0);
    expect(state.headingDeg).toBeGreaterThan(350);
  });

  it('курс не определён — продолжает плавно, не дёргаясь', () => {
    const moving = { headingDeg: 40, rateDegS: 10 };
    const next = springHeading(moving, Number.NaN, FRAME_S);
    expect(next.headingDeg).toBeGreaterThan(40);
    expect(next.rateDegS).toBeLessThanOrEqual(10);
  });

  it('нулевой шаг кадра — состояние не меняется', () => {
    const moving = { headingDeg: 40, rateDegS: 10 };
    expect(springHeading(moving, 90, 0)).toEqual(moving);
  });
});
