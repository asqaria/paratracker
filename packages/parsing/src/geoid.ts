import { meanSeaLevel } from 'egm96-universal';

/**
 * Широта WGS84, °. Своя копия, а не импорт из track-builder: тот сам зависит
 * от этого модуля через altitude-datum, и импорт замкнул бы цикл.
 */
const MAX_LATITUDE_DEG = 90;

/**
 * Высота геоида EGM96 над эллипсоидом WGS84, м — N в h = H + N.
 *
 * EGM96, а не более точная EGM2008: GNSS-приёмник переводит высоту в «уровень
 * моря» по встроенной EGM96, и отменить нужно ровно её (спек высот, «Модель
 * геоида»). Сетка NGA 15′, билинейная интерполяция. Пакет спрятан за этой
 * функцией: замена источника данных — правка одного файла.
 *
 * Широта вне [−90, 90] или NaN — NaN: пакет на таких значениях читает за
 * пределами сетки и бросает, а парсер бросать не должен (CLAUDE.md).
 */
export function geoidHeightM(latDeg: number, lonDeg: number): number {
  if (!(Math.abs(latDeg) <= MAX_LATITUDE_DEG) || !Number.isFinite(lonDeg)) return Number.NaN;
  return meanSeaLevel(latDeg, lonDeg);
}
