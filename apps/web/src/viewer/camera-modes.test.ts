import { describe, expect, it } from 'vitest';

import {
  CAMERA_HOTKEY_ORDER,
  CAMERA_MODES,
  CAMERA_POSES,
  CHASE_SMOOTHING_TAU_S,
  DEFAULT_CAMERA_MODE,
  shortestTurn,
  smoothHeading,
} from './camera-modes';

describe('режимы камеры', () => {
  it('Фаза 1: четыре режима, цифры 1–4 в порядке ТЗ §7.5', () => {
    expect(CAMERA_MODES).toEqual(['chase', 'free', 'cockpit', 'top']);
    expect(CAMERA_HOTKEY_ORDER).toEqual(['chase', 'free', 'cockpit', 'top']);
    expect(CAMERA_MODES).toContain(DEFAULT_CAMERA_MODE);
  });

  it('free — режим без слежения, остальные с позой', () => {
    expect(CAMERA_POSES.free).toBeNull();
    expect(CAMERA_POSES.chase).toMatchObject({ headingDeg: null, pitchDeg: -14, rangeM: 90 });
    expect(CAMERA_POSES.cockpit?.rangeM).toBeLessThan(CAMERA_POSES.chase?.rangeM ?? 0);
    expect(CAMERA_POSES.top).toMatchObject({ headingDeg: 0 });
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
