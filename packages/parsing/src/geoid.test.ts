import { describe, expect, it } from 'vitest';

import { geoidHeightM } from './geoid.js';

/**
 * Опорные значения — узлы сетки из исходного файла NGA WW15MGH.DAC
 * (EGM96 15′, INTEGER*2 big-endian, сантиметры; 721 строка с 90° N на юг,
 * 1440 столбцов с 0° E на восток — описание формата в readme.txt NGA).
 * Файл декодирован независимо от egm96-universal. В узле билинейная
 * интерполяция обязана вернуть значение узла ровно.
 */
const NGA_NODES: ReadonlyArray<[lat: number, lon: number, heightM: number]> = [
  [43, 76.5, -41.35], // Заилийский Алатау, ячейка реальных треков
  [43.25, 76.5, -44.1],
  [43, 76.75, -41.31],
  [43.25, 76.75, -44.1],
  [0, 0, 17.16],
  [90, 0, 13.61],
  [-90, 0, -29.53],
  [50.75, 5.75, 46.42],
  [-45, -70, 16.93],
];

const CENTIMETRE = 0.005;

describe('geoidHeightM — EGM96', () => {
  it.each(NGA_NODES)('узел сетки NGA %f, %f → %f м', (lat, lon, heightM) => {
    expect(Math.abs(geoidHeightM(lat, lon) - heightM)).toBeLessThan(CENTIMETRE);
  });

  it('внутри ячейки — билинейная интерполяция четырёх узлов', () => {
    // Старт реального трека: 43.1274, 76.4648 → ячейка [43, 43.25] × [76.25, 76.5].
    // Значение посчитано вручную из узлов WW15MGH.DAC: −42.7383 м.
    expect(Math.abs(geoidHeightM(43.1274, 76.4648) - -42.7383)).toBeLessThan(CENTIMETRE);
  });

  it('долгота 0…360 и −180…180 — одна и та же точка', () => {
    expect(geoidHeightM(43, 283.5)).toBeCloseTo(geoidHeightM(43, -76.5), 9);
    expect(geoidHeightM(43, -76.5)).toBeCloseTo(-34.58, 2); // узел NGA (43, 283.5)
    expect(geoidHeightM(10, 180)).toBeCloseTo(geoidHeightM(10, -180), 9);
  });

  it('широта вне [−90, 90] или NaN — NaN, а не исключение (парсер не бросает)', () => {
    // egm96-universal на 90.0001 падает с RangeError: читает за пределами сетки.
    expect(geoidHeightM(90.0001, 0)).toBeNaN();
    expect(geoidHeightM(-91, 0)).toBeNaN();
    expect(geoidHeightM(Number.NaN, 0)).toBeNaN();
    expect(geoidHeightM(43, Number.NaN)).toBeNaN();
  });

  it('детерминирован: одна точка — одно значение', () => {
    expect(geoidHeightM(43.1274, 76.4648)).toBe(geoidHeightM(43.1274, 76.4648));
  });
});
