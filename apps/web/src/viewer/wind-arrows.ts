import type { WindBandDto, WindDto } from '@skyline/core';

/**
 * Ветер на сцене (задача 3.14, ТЗ §7.2): поле штрихов у пилота
 * (wind-particles.ts) и колонка слоёв в углу. Ветер в данных — метеорологический, «откуда дует» (CLAUDE.md);
 * стрелка показывает, куда сносит: так её читают на сцене вместе с треком.
 */

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

/** Слои для колонки в углу: сверху — выше, как в небе. */
export const layersTopDown = (profile: readonly WindBandDto[]): WindBandDto[] =>
  [...profile].sort((a, b) => b.altitudeBand[0] - a.altitudeBand[0]);
