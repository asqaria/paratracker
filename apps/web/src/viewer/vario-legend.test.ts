import { describe, expect, it } from 'vitest';

import { LEGEND_TICKS_MS, legendGradient, legendPosition, legendTicks } from './vario-legend';
import { VARIO_RANGE_MS, VARIO_STOPS, varioCss } from './vario-palette';

describe('legendPosition', () => {
  it('линейно по скорости: −5 → 0 %, 0 → 50 %, +5 → 100 %', () => {
    expect(legendPosition(-VARIO_RANGE_MS)).toBe(0);
    expect(legendPosition(0)).toBe(50);
    expect(legendPosition(VARIO_RANGE_MS)).toBe(100);
    expect(legendPosition(0.5)).toBe(55);
  });

  it('за пределами диапазона — зажимается к краям, как цвет трека', () => {
    expect(legendPosition(-8)).toBe(0);
    expect(legendPosition(12)).toBe(100);
  });
});

describe('legendGradient', () => {
  const gradient = legendGradient();

  it('каждая опорная точка палитры — на своей позиции, а не равномерно', () => {
    // Равномерная раскладка семи цветов поставила бы +0.5 на 66.7 %, где по шкале почти +2.
    for (const stop of VARIO_STOPS) {
      expect(gradient).toContain(`${varioCss(stop.vSpeed)} ${legendPosition(stop.vSpeed)}%`);
    }
  });

  it('слева направо, от снижения к набору', () => {
    expect(gradient.startsWith('linear-gradient(to right, ')).toBe(true);
    expect(gradient.indexOf(varioCss(-VARIO_RANGE_MS))).toBeLessThan(gradient.indexOf(varioCss(VARIO_RANGE_MS)));
  });
});

describe('legendTicks', () => {
  it('подписи −5, −2, 0, +2, +5 на истинных позициях', () => {
    expect(LEGEND_TICKS_MS).toEqual([-5, -2, 0, 2, 5]);
    expect(legendTicks('ru')).toEqual([
      { vSpeed: -5, positionPct: 0, label: '-5' },
      { vSpeed: -2, positionPct: 30, label: '-2' },
      { vSpeed: 0, positionPct: 50, label: '0' },
      { vSpeed: 2, positionPct: 70, label: '+2' },
      { vSpeed: 5, positionPct: 100, label: '+5' },
    ]);
  });
});
