import type { WindBandDto, WindDto } from '@skyline/core';

/**
 * Стрелки ветра (задача 3.14, ТЗ §7.2): у пилота на сцене и колонкой слоёв
 * в углу. Ветер в данных — метеорологический, «откуда дует» (CLAUDE.md);
 * стрелка показывает, куда сносит: так её читают на сцене вместе с треком.
 */

export const WIND_ARROW = {
  /**
   * Стрелка у пилота — значок в плоскости экрана, а не отрезок на местности:
   * в Chase ветер «на камеру» давал отрезок от пилота до низа экрана.
   * Размер значка при масштабе 1, px.
   */
  sizePx: 36,
  /** Ниже пилота на экране, px: над ним значок закрывал бы купол. */
  offsetBelowPx: 48,
  /** Масштаб = base + perMs × скорость, в пределах [min, max]: штиль виден, шторм не на полэкрана. */
  baseScale: 0.6,
  scalePerMs: 0.1,
  minScale: 0.6,
  maxScale: 1.6,
} as const;

const FULL_TURN_DEG = 360;
const HALF_TURN_DEG = 180;

const normalize = (deg: number): number => ((deg % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG;

/** Куда сносит: метеорологическое «откуда» + 180°. */
export const downwindDeg = (fromDeg: number): number => normalize(fromDeg + HALF_TURN_DEG);

export interface WindHere {
  /** Метеорологическое, откуда дует. */
  dirDeg: number;
  speedMs: number;
  /** Слой профиля; null — вне слоёв, ветер полёта целиком. */
  band: readonly [number, number] | null;
}

/**
 * Ветер на высоте altM: слой профиля, в который она попадает (границы —
 * [нижняя, верхняя)). Вне профиля — ветер полёта: над последним слоем
 * пилот не кружил, и выдумывать экстраполяцию хуже, чем показать средний.
 */
export function windAt(profile: readonly WindBandDto[], flight: WindDto | null, altM: number): WindHere | null {
  if (Number.isFinite(altM)) {
    const band = profile.find((b) => altM >= b.altitudeBand[0] && altM < b.altitudeBand[1]);
    if (band) return { dirDeg: band.windDirDeg, speedMs: band.windSpeedMs, band: band.altitudeBand };
  }
  return flight ? { dirDeg: flight.dirDeg, speedMs: flight.speedMs, band: null } : null;
}

/** Масштаб значка у пилота: растёт со скоростью ветра. */
export const arrowScale = (speedMs: number): number =>
  Math.min(WIND_ARROW.maxScale, Math.max(WIND_ARROW.minScale, WIND_ARROW.baseScale + speedMs * WIND_ARROW.scalePerMs));

/** Поворот стрелки на экране, ° по часовой от «вверх»: куда сносит относительно курса камеры. */
export const screenRotationDeg = (fromDeg: number, cameraHeadingDeg: number): number =>
  normalize(downwindDeg(fromDeg) - cameraHeadingDeg);

/** Слои для колонки в углу: сверху — выше, как в небе. */
export const layersTopDown = (profile: readonly WindBandDto[]): WindBandDto[] =>
  [...profile].sort((a, b) => b.altitudeBand[0] - a.altitudeBand[0]);
