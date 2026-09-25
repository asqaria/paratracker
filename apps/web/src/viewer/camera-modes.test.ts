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
  smoothHeading,
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

describe('smoothHeading', () => {
  it('первый кадр берёт курс как есть', () => {
    expect(smoothHeading(null, 123, 1)).toBe(123);
  });

  it('за τ проходит большую часть пути, но не перескакивает', () => {
    const step = smoothHeading(0, 100, CHASE_SMOOTHING_TAU_S / 2);
    expect(step).toBeCloseTo(50, 9);
    expect(smoothHeading(0, 100, CHASE_SMOOTHING_TAU_S)).toBeCloseTo(100, 9);
    // Даже при огромном шаге времени — не дальше цели.
    expect(smoothHeading(0, 100, 100)).toBeCloseTo(100, 9);
  });

  it('идёт коротким путём через 360°', () => {
    expect(smoothHeading(350, 10, CHASE_SMOOTHING_TAU_S)).toBeCloseTo(370, 9);
  });

  it('курс не определён — держим прежний', () => {
    expect(smoothHeading(42, Number.NaN, 1)).toBe(42);
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
