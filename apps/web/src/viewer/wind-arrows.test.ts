import type { WindBandDto } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import {
  arrowScale,
  downwindDeg,
  layersTopDown,
  screenRotationDeg,
  WIND_ARROW,
  windAt,
} from './wind-arrows';

const band = (low: number, dirDeg: number, speedMs: number): WindBandDto => ({
  altitudeBand: [low, low + 250],
  windDirDeg: dirDeg,
  windSpeedMs: speedMs,
  confidence: 0.8,
  circleCount: 5,
});

const PROFILE = [band(1500, 270, 4), band(1750, 300, 6), band(2000, 315, 9)];
const FLIGHT = { dirDeg: 290, speedMs: 5 };

describe('windAt — ветер на высоте пилота', () => {
  it('слой, в который попадает высота; граница — к верхнему слою', () => {
    expect(windAt(PROFILE, FLIGHT, 1800)).toEqual({ dirDeg: 300, speedMs: 6, band: [1750, 2000] });
    expect(windAt(PROFILE, FLIGHT, 2000)).toEqual({ dirDeg: 315, speedMs: 9, band: [2000, 2250] });
  });

  it('вне профиля — ветер полёта; нет ничего — null', () => {
    expect(windAt(PROFILE, FLIGHT, 3000)).toEqual({ dirDeg: 290, speedMs: 5, band: null });
    expect(windAt(PROFILE, FLIGHT, Number.NaN)).toEqual({ dirDeg: 290, speedMs: 5, band: null });
    expect(windAt([], null, 1800)).toBeNull();
  });
});

describe('направление и стрелка', () => {
  it('дует с запада — сносит на восток', () => {
    expect(downwindDeg(270)).toBe(90);
    expect(downwindDeg(90)).toBe(270);
    expect(downwindDeg(0)).toBe(180);
  });

  it('значок растёт со скоростью, в пределах', () => {
    expect(arrowScale(5)).toBeCloseTo(WIND_ARROW.baseScale + 5 * WIND_ARROW.scalePerMs, 9);
    expect(arrowScale(0)).toBe(WIND_ARROW.minScale);
    expect(arrowScale(100)).toBe(WIND_ARROW.maxScale);
  });

  it('на экране — относительно курса камеры: камера смотрит по ветру — стрелка вверх', () => {
    expect(screenRotationDeg(270, 90)).toBe(0);
    expect(screenRotationDeg(270, 0)).toBe(90);
    expect(screenRotationDeg(0, 90)).toBe(90);
  });

  it('колонка — сверху выше', () => {
    expect(layersTopDown(PROFILE).map((b) => b.altitudeBand[0])).toEqual([2000, 1750, 1500]);
  });
});
