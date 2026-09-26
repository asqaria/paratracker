import { TRACK_FLAGS, type FlightRange } from '@skyline/core';

import { MS_PER_SECOND } from './playback';

/**
 * «Занавес» под треком (ТЗ §7.2, задача 2.8) — расчёт без Cesium. Стена от
 * трека до земли по прореженным точкам участка полёта; между термиками —
 * отдельные стены. В режиме «Пройденный» край каждой стены обрезается по
 * пилоту в каждом кадре — занавес идёт вместе с линией.
 */

export const CURTAIN = {
  /**
   * Точка стены — раз в столько секунд: стена широкая и прозрачная, мелкий
   * изгиб трека на ней не виден, а рельеф под каждой точкой спрашивается
   * отдельно. В «Пройденном» край стены идёт за пилотом плавно (pieceProgress).
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

/**
 * Стены занавеса: непрерывные участки показанных сегментов (между термиками),
 * по индексам точек трека. Соседняя точка с теми же координатами выброшена:
 * WallGeometry выбросила бы её сама, и номер точки перестал бы совпадать
 * с координатой s стены (s = номер точки / (число точек − 1)).
 */
export function curtainPieces(
  samples: readonly number[],
  shownSegments: readonly boolean[],
  lat: Float64Array,
  lon: Float64Array,
): number[][] {
  const pieces: number[][] = [];
  let piece: number[] = [];
  const close = (): void => {
    if (piece.length >= 2) pieces.push(piece);
    piece = [];
  };
  const push = (index: number): void => {
    const last = piece.at(-1);
    if (last !== undefined && lat[last] === lat[index] && lon[last] === lon[index]) return;
    piece.push(index);
  };
  shownSegments.forEach((shown, k) => {
    if (!shown) {
      close();
      return;
    }
    if (piece.length === 0) push(samples[k] ?? 0);
    push(samples[k + 1] ?? 0);
  });
  close();
  return pieces;
}

/**
 * Докуда рисовать стену в момент timeMs — координата s (0…1): номер отрезка,
 * где пилот, плюс доля времени внутри него. На 5 с отрезка скорость почти
 * постоянна, и доля времени — это доля пути вдоль стены: край идёт за пилотом
 * непрерывно, без ступенек. 0 — пилот до стены, 1 — стена пройдена.
 */
export function pieceProgress(t: Float64Array, piece: readonly number[], timeMs: number): number {
  const last = piece.length - 1;
  if (last < 1) return 0;
  const first = t[piece[0] ?? 0] ?? Infinity;
  if (timeMs <= first) return 0;
  if (timeMs >= (t[piece[last] ?? 0] ?? -Infinity)) return 1;
  let k = 0;
  while (k < last - 1 && (t[piece[k + 1] ?? 0] ?? Infinity) <= timeMs) k += 1;
  const from = t[piece[k] ?? 0] ?? 0;
  const to = t[piece[k + 1] ?? 0] ?? 0;
  const fraction = to > from ? (timeMs - from) / (to - from) : 1;
  return (k + fraction) / last;
}

/** ТЗ §5.3: на мобильном GPU занавес по умолчанию выключен. */
export const curtainOnByDefault = (compact: boolean): boolean => !compact;
