import { TRACK_FLAGS, type FlightRange } from '@skyline/core';

import { MS_PER_SECOND } from './playback';

/**
 * «Занавес» под треком (ТЗ §7.2, задача 2.8) — расчёт без Cesium. Стена от
 * трека до земли по прореженным точкам участка полёта, сегментами между
 * соседними точками: в режиме «Пройденный» сегменты показываются за пилотом.
 */

export const CURTAIN = {
  /**
   * Точка стены — раз в столько секунд: стена широкая и прозрачная, мелкий
   * изгиб трека на ней не виден, а рельеф под каждой точкой спрашивается
   * отдельно. «Пройденный» отстаёт от пилота не больше чем на этот шаг.
   */
  sampleStepS: 5,
  /**
   * Непрозрачность у трека; к земле — до нуля (градиент по высоте над рельефом).
   * 0.35 у камеры читалась молочным листом поверх рельефа; 0.25 — стены дальних
   * глайдов, на которые Chase смотрит почти с торца, складывались в белые «башни».
   */
  topAlpha: 0.15,
  /**
   * Степень градиента: alpha = topAlpha · t^k, t — доля высоты от земли до трека.
   * k > 1 — стена заметна у трека и быстро тает вниз, не заслоняя рельеф.
   */
  fadePower: 2,
  /**
   * Уровень тайлов рельефа для низа стены: ~40 м на пиксель тайла. Низ под
   * рельефом скрыт проверкой глубины, для градиента такой точности хватает,
   * а опрос на максимальной детализации тянул бы сотни тайлов вдоль маршрута.
   */
  terrainLevel: 11,
} as const;

/** Индексы точек стены: от взлёта до посадки раз в CURTAIN.sampleStepS, посадка — последней. */
export function curtainSamples(t: Float64Array, range: FlightRange): number[] {
  const { takeoff, landing } = range;
  if (takeoff < 0 || landing <= takeoff) return [];
  const stepMs = CURTAIN.sampleStepS * MS_PER_SECOND;
  const samples = [takeoff];
  let next = (t[takeoff] ?? 0) + stepMs;
  for (let i = takeoff + 1; i < landing; i++) {
    // По времени, а не по номеру: через разрыв записи сетка точек не равномерна.
    if ((t[i] ?? 0) >= next) {
      samples.push(i);
      next = (t[i] ?? 0) + stepMs;
    }
  }
  samples.push(landing);
  return samples;
}

/** Сколько сегментов стены (между соседними точками) пилот уже пролетел к моменту timeMs. */
export function flownSegments(t: Float64Array, samples: readonly number[], timeMs: number): number {
  let count = 0;
  while (count + 1 < samples.length && (t[samples[count + 1] ?? 0] ?? Infinity) <= timeMs) count += 1;
  return count;
}

/**
 * Какие сегменты стены рисовать: в термике — нет. Спираль, свёрнутая в стену,
 * накладывается на себя десятки раз, прозрачность складывается в белые «башни»,
 * а термик и так отмечен колонной (задача 2.7). Скрыт и сегмент входа или
 * выхода (в термике один конец): один такой сегмент стоял отдельным узким
 * листом — «прутом» у каждого термика. Стена переходов обрывается чисто.
 */
export function curtainSegmentsShown(samples: readonly number[], flags: Uint8Array): boolean[] {
  const inThermal = (index: number): boolean => ((flags[index] ?? 0) & TRACK_FLAGS.thermal) !== 0;
  return samples.slice(1).map((end, k) => !(inThermal(samples[k] ?? 0) || inThermal(end)));
}

/** ТЗ §5.3: на мобильном GPU занавес по умолчанию выключен. */
export const curtainOnByDefault = (compact: boolean): boolean => !compact;
