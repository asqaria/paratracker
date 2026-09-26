import { GAIN } from '@skyline/core';

/**
 * Суммарный набор высоты за полёт (задача 2.12, ТЗ §9 total_gain_m): сумма
 * всех подъёмов, в отличие от «макс. набора» сводки — одного непрерывного.
 *
 * Гистерезис: от опорной высоты подъём засчитывается, когда вырос на порог,
 * и опора поднимается; спуск на порог опускает опору. Колебания меньше
 * порога — шум, их сумма раздула бы набор в разы (1 м дрожи барометра на
 * каждой секунде — километры за час).
 *
 * Только точки from..to: подъём пешком на старт — не набор в полёте.
 */
export function totalGain(alt: Float64Array, from: number, to: number, hysteresisM: number = GAIN.hysteresisM): number {
  let gain = 0;
  let ref = Number.NaN;
  for (let i = Math.max(0, from); i <= to && i < alt.length; i++) {
    const a = alt[i] ?? Number.NaN;
    if (Number.isNaN(a)) continue;
    if (Number.isNaN(ref)) {
      ref = a;
    } else if (a - ref >= hysteresisM) {
      gain += a - ref;
      ref = a;
    } else if (ref - a >= hysteresisM) {
      ref = a;
    }
  }
  return gain;
}
