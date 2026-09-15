import type { AltitudeSource } from './flight.js';
import type { ParseWarning } from './parse.js';

/**
 * Точка трека объектом — модель ТЗ §3.4. Для тестов и отладки;
 * конвейер работает с колонками {@link TrackColumns}.
 */
export interface TrackPoint {
  /** UNIX-время, мс, UTC. */
  t: number;
  /** Градусы WGS84. */
  lat: number;
  lon: number;
  /** Барометрическая высота (QNE/ISA), м. */
  altBaro: number | null;
  /** GNSS-высота, м. */
  altGnss: number | null;
  /** 3D-фикс. */
  valid: boolean;
  /** Точность фикса, м. */
  fxa?: number;
  /** Число спутников. */
  siu?: number;
}

/**
 * Точки трека колонками: CLAUDE.md требует для больших массивов типизированные
 * массивы — они компактны и передаются между потоками как transferable.
 * Все колонки одной длины; отсутствующее значение в Float64Array — NaN.
 */
export interface TrackColumns {
  /** UNIX-время, мс, UTC; строго возрастает. */
  t: Float64Array;
  /** Градусы WGS84. */
  lat: Float64Array;
  lon: Float64Array;
  /** Барометрическая высота (QNE/ISA), м; NaN — нет. */
  altBaro: Float64Array;
  /** GNSS-высота, м; NaN — нет. */
  altGnss: Float64Array;
  /** 1 — 3D-фикс, 0 — 2D. */
  valid: Uint8Array;
  /** Точность фикса, м; NaN — нет. */
  fxa: Float64Array;
  /** Число спутников; NaN — нет. */
  siu: Float64Array;
}

/** Откуда дата: заголовок IGC, имя файла или время самих точек (GPX, KML). */
export const DATE_SOURCES = ['header', 'filename', 'fix_time'] as const;
export type DateSource = (typeof DATE_SOURCES)[number];

export interface TrackMeta {
  /** Дата первого фикса, UTC, `YYYY-MM-DD`; null — не найдена, спросить пользователя. */
  date: string | null;
  dateSource: DateSource | null;
  pilot?: string;
  glider?: string;
  gliderId?: string;
  device?: string;
  site?: string;
  /** Производитель и серийник логгера (IGC A-запись). */
  logger?: string;
  /** Цифровая подпись (IGC G-записи) — для последующей валидации. */
  signature?: string;
}

/** Результат любого парсера (ТЗ §3.4). */
export interface ParsedTrack {
  points: TrackColumns;
  meta: TrackMeta;
  warnings: ParseWarning[];
  /** Источник высоты для вариометра: баро, если прибор её пишет. */
  altitudeSource: AltitudeSource;
}

export function trackLength(points: TrackColumns): number {
  return points.t.length;
}

const orNull = (value: number | undefined): number | null =>
  value === undefined || Number.isNaN(value) ? null : value;

/** Точка `index` в виде объекта ТЗ §3.4. */
export function pointAt(points: TrackColumns, index: number): TrackPoint {
  if (!Number.isInteger(index) || index < 0 || index >= trackLength(points)) {
    throw new RangeError(`Point index ${index} is out of range 0..${trackLength(points) - 1}`);
  }
  const point: TrackPoint = {
    t: points.t[index] ?? Number.NaN,
    lat: points.lat[index] ?? Number.NaN,
    lon: points.lon[index] ?? Number.NaN,
    altBaro: orNull(points.altBaro[index]),
    altGnss: orNull(points.altGnss[index]),
    valid: points.valid[index] === 1,
  };
  const fxa = orNull(points.fxa[index]);
  const siu = orNull(points.siu[index]);
  if (fxa !== null) point.fxa = fxa;
  if (siu !== null) point.siu = siu;
  return point;
}
