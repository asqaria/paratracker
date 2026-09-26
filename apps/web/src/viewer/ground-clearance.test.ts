import { describe, expect, it } from 'vitest';

import { CLEARANCE, liftAboveGround, pitchClearingGround } from './ground-clearance';

/**
 * Параплан и камера не уходят под рельеф: высота модели — не ниже земли плюс
 * подвеска, камера следящих режимов — не ниже земли плюс запас (наклон
 * увеличивается, дальность сохраняется).
 */

describe('liftAboveGround', () => {
  it('над землёй — высота трека как есть', () => {
    expect(liftAboveGround(1500, 1200)).toBe(1500);
  });

  it('трек ушёл под рельеф (ошибка GPS у склона) — модель на земле плюс подвеска', () => {
    expect(liftAboveGround(1195, 1200)).toBe(1200 + CLEARANCE.gliderM);
  });

  it('рельеф ещё не загружен — высота трека', () => {
    expect(liftAboveGround(1195, undefined)).toBe(1195);
  });
});

describe('pitchClearingGround', () => {
  const offsetUp = (rangeM: number, pitchDeg: number): number => -rangeM * Math.sin((pitchDeg * Math.PI) / 180);

  it('камера над землёй — наклон не меняется', () => {
    expect(pitchClearingGround({ pitchDeg: -14, rangeM: 90 }, 1500, 1300)).toBe(-14);
  });

  it('склон за пилотом выше камеры — наклон круче, камера ровно на запас над склоном', () => {
    // Пилот на 1500 м, камера при −14° на 90 м — на 21.8 м выше; склон под ней — 1525 м.
    const pitch = pitchClearingGround({ pitchDeg: -14, rangeM: 90 }, 1500, 1525);
    expect(pitch).toBeLessThan(-14);
    expect(1500 + offsetUp(90, pitch)).toBeCloseTo(1525 + CLEARANCE.cameraM, 6);
  });

  it('склон выше, чем достаёт дальность, — почти отвесно сверху, но не в надир', () => {
    expect(pitchClearingGround({ pitchDeg: -14, rangeM: 90 }, 1500, 1700)).toBe(CLEARANCE.steepestPitchDeg);
  });

  it('близкая камера (Cockpit, 12 м) — запас не больше 20 % дальности, а не 10 м', () => {
    // Пилот стоит на земле: 1201 м, земля под камерой 1200 м.
    const pitch = pitchClearingGround({ pitchDeg: -6, rangeM: 12 }, 1201, 1200);
    expect(1201 + offsetUp(12, pitch)).toBeCloseTo(1200 + 12 * CLEARANCE.cameraRangeFraction, 6);
    expect(pitch).toBeGreaterThan(-15);
  });

  it('рельеф не загружен — наклон не меняется', () => {
    expect(pitchClearingGround({ pitchDeg: -14, rangeM: 90 }, 1500, undefined)).toBe(-14);
  });
});
