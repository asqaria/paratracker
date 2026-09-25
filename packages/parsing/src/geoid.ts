import { meanSeaLevel } from 'egm96-universal';

/**
 * Высота геоида EGM96 над эллипсоидом WGS84, м — N в h = H + N.
 *
 * EGM96, а не более точная EGM2008: GNSS-приёмник переводит высоту в «уровень
 * моря» по встроенной EGM96, и отменить нужно ровно её (спек высот, «Модель
 * геоида»). Сетка NGA 15′, билинейная интерполяция. Пакет спрятан за этой
 * функцией: замена источника данных — правка одного файла.
 */
export function geoidHeightM(latDeg: number, lonDeg: number): number {
  return meanSeaLevel(latDeg, lonDeg);
}
