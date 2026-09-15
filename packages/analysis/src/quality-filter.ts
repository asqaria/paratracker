import type { TrackColumns } from '@skyline/core';

export interface QualityLimits {
  /** Максимальная заявленная точность фикса (FXA), м. */
  maxAccuracyM: number;
  /** Минимальное число спутников (SIU). */
  minSatellites: number;
}

export interface QualityResult {
  points: TrackColumns;
  dropped: number;
  /** Фильтр не применён: отброшено было бы всё — прибор пишет в поля мусор. */
  skipped: boolean;
}

/**
 * ТЗ §5.2 шаг 3: отбросить фиксы с fxa > maxAccuracyM или siu < minSatellites.
 * Поле не записано (NaN) — по нему не судим.
 */
export function dropLowQualityFixes(points: TrackColumns, limits: QualityLimits): QualityResult {
  const n = points.t.length;
  const kept: number[] = [];
  for (let i = 0; i < n; i++) {
    const fxa = points.fxa[i] ?? Number.NaN;
    const siu = points.siu[i] ?? Number.NaN;
    // Сравнение с NaN ложно — отсутствующее поле фикс не отбрасывает.
    if (!(fxa > limits.maxAccuracyM) && !(siu < limits.minSatellites)) kept.push(i);
  }

  if (kept.length === n) return { points, dropped: 0, skipped: false };
  if (kept.length === 0) return { points, dropped: 0, skipped: true };

  const pick = (column: Float64Array): Float64Array => Float64Array.from(kept, (i) => column[i] ?? Number.NaN);
  return {
    points: {
      t: pick(points.t),
      lat: pick(points.lat),
      lon: pick(points.lon),
      altBaro: pick(points.altBaro),
      altGnss: pick(points.altGnss),
      valid: Uint8Array.from(kept, (i) => points.valid[i] ?? 0),
      fxa: pick(points.fxa),
      siu: pick(points.siu),
    },
    dropped: n - kept.length,
    skipped: false,
  };
}
