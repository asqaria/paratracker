import { TRACK_FLAGS, type FlightRange } from '@skyline/core';

import type { CameraMode } from './camera-modes';


/**
 * «Занавес» под треком (ТЗ §7.2, задача 2.8) — расчёт без Cesium. Стена от
 * трека до земли по прореженным точкам участка полёта; между термиками —
 * отдельные стены. В режиме «Пройденный» край каждой стены обрезается по
 * пилоту в каждом кадре — занавес идёт вместе с линией.
 */

export const CURTAIN = {
  /**
   * Непрозрачность у трека и у земли. Раньше к земле стена растворялась до
   * нуля — нижний край пропадал, и высоту было не с чем сравнить: стена
   * читалась только верхней кромкой. Теперь почти ровная — «забор» своей высоты.
   */
  topAlpha: 0.2,
  bottomAlpha: 0.12,
  /**
   * Кромка у рельефа: нижняя доля высоты стены плотнее — видно, где стена
   * встала на землю, и высота читается как расстояние от линии до этой кромки.
   */
  groundEdge: { fraction: 0.03, alpha: 0.4 },
  /**
   * Уровень тайлов рельефа для низа стены: ~40 м на пиксель тайла. Опрашивается
   * каждая точка полёта — на максимальной детализации это сотни тайлов вдоль
   * маршрута, а кромке у земли такой точности хватает.
   */
  terrainLevel: 11,
} as const;

/**
 * Индексы точек стены: каждая точка от взлёта до посадки — те же вершины,
 * что у линии и тени. Прореженная стена (раз в 5 с) шла хордами: на вираже
 * её верх срезал дугу линии, а низ расходился с тенью.
 */
export function curtainSamples(range: FlightRange): number[] {
  const { takeoff, landing } = range;
  if (takeoff < 0 || landing <= takeoff) return [];
  return Array.from({ length: landing - takeoff + 1 }, (_, k) => takeoff + k);
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

/**
 * Занавес — только в Side и Free: сбоку и со стороны стена показывает высоту
 * над рельефом. Из Chase и Cockpit камера смотрит вдоль трека — стены видны
 * с торца и складываются в полосы; из Top — сверху, стена вырождается в линию.
 */
export const curtainInMode = (mode: CameraMode): boolean => mode === 'side' || mode === 'free';

/** ТЗ §5.3: на мобильном GPU занавес по умолчанию выключен. */
export const curtainOnByDefault = (compact: boolean): boolean => !compact;
