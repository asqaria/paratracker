import { describe, expect, it } from 'vitest';

import { varioCss, varioRgb, VARIO_RANGE_MS, VARIO_STOPS } from './vario-palette';

describe('палитра вариометра', () => {
  it('на узлах шкалы цвет ровно из токенов ТЗ §8.4', () => {
    for (const stop of VARIO_STOPS) {
      expect(varioRgb(stop.vSpeed), `${stop.vSpeed} м/с`).toEqual([...stop.rgb]);
    }
  });

  it('между узлами — линейная интерполяция', () => {
    // Середина между 0 (0x6B7280) и +0.5 (0xC9A227).
    expect(varioRgb(0.25)).toEqual([
      Math.round((0x6b + 0xc9) / 2),
      Math.round((0x72 + 0xa2) / 2),
      Math.round((0x80 + 0x27) / 2),
    ]);
  });

  it('за диапазоном ±5 м/с цвет клипуется', () => {
    expect(varioRgb(-20)).toEqual(varioRgb(-VARIO_RANGE_MS));
    expect(varioRgb(20)).toEqual(varioRgb(VARIO_RANGE_MS));
  });

  it('ноль — серый, а не белый: на облаках и снеге белый не читается', () => {
    expect(varioRgb(0)).toEqual([0x6b, 0x72, 0x80]);
  });

  it('NaN — нейтральный цвет, а не чёрный', () => {
    expect(varioRgb(Number.NaN)).toEqual([0x6b, 0x72, 0x80]);
  });

  it('css-строка для легенды и телеметрии', () => {
    expect(varioCss(5)).toBe('rgb(201 42 42)');
  });
});
