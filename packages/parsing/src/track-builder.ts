import {
  PARSER,
  type AltitudeSource,
  type ParseResult,
  type ParseWarning,
  type ParseWarningCode,
  type TrackColumns,
  type TrackMeta,
} from '@skyline/core';

import { checkFixDate, isoDate } from './dates.js';

/** Общая часть всех парсеров: опции, журнал предупреждений, накопление точек. */

export interface ParseLimits {
  maxFileBytes: number;
  maxPoints: number;
}

export interface ParseOptions {
  /** «Сейчас», UNIX мс — для санити-чека даты. Параметр, а не Date.now(): парсер детерминирован. */
  now: number;
  /** Имя загруженного файла — запасной источник даты для IGC (ТЗ §3.3). */
  fileName?: string;
  /** Переопределение лимитов ТЗ §3.3. */
  limits?: Partial<ParseLimits>;
}

export function resolveLimits(options: ParseOptions): ParseLimits {
  return { maxFileBytes: PARSER.maxFileBytes, maxPoints: PARSER.maxPoints, ...options.limits };
}

const MAX_LAT_DEGREES = 90;
const MAX_LON_DEGREES = 180;

export function isValidCoordinate(lat: number, lon: number): boolean {
  return Math.abs(lat) <= MAX_LAT_DEGREES && Math.abs(lon) <= MAX_LON_DEGREES;
}

export class WarningLog {
  private readonly items: ParseWarning[] = [];
  private truncated = false;

  add(code: ParseWarningCode, line?: number): void {
    if (this.items.length >= PARSER.maxWarnings) {
      this.truncated = true;
      return;
    }
    this.items.push(line === undefined ? { code } : { code, line });
  }

  list(): ParseWarning[] {
    return this.truncated ? [...this.items, { code: 'warnings_truncated' }] : [...this.items];
  }
}

/** Значения одной точки; отсутствующее — NaN, valid — 1 или 0. */
export interface FixValues {
  t: number;
  lat: number;
  lon: number;
  altBaro: number;
  altGnss: number;
  valid: number;
  fxa: number;
  siu: number;
}

export type PushResult = 'added' | 'skipped' | 'limit';

const DEFAULT_INITIAL_CAPACITY = 1024;
const GROWTH_FACTOR = 2;

function allocateColumns(capacity: number): TrackColumns {
  return {
    t: new Float64Array(capacity),
    lat: new Float64Array(capacity),
    lon: new Float64Array(capacity),
    altBaro: new Float64Array(capacity),
    altGnss: new Float64Array(capacity),
    valid: new Uint8Array(capacity),
    fxa: new Float64Array(capacity),
    siu: new Float64Array(capacity),
  };
}

/**
 * Копит точки в колонки. Время строго возрастает: точка с тем же временем —
 * дубликат (остаётся первая), с меньшим — фикс не по порядку (ТЗ §3.3).
 */
export class TrackBuilder {
  private columns: TrackColumns;
  private size = 0;
  private last = Number.NEGATIVE_INFINITY;
  private readonly maxPoints: number;
  private readonly warnings: WarningLog;

  constructor(options: { maxPoints: number; warnings: WarningLog; initialCapacity?: number }) {
    this.maxPoints = options.maxPoints;
    this.warnings = options.warnings;
    const capacity = Math.min(options.initialCapacity ?? DEFAULT_INITIAL_CAPACITY, options.maxPoints);
    this.columns = allocateColumns(Math.max(1, capacity));
  }

  get count(): number {
    return this.size;
  }

  /** Время последней принятой точки; −∞, пока точек нет. */
  get lastTime(): number {
    return this.last;
  }

  push(fix: FixValues, line: number | undefined): PushResult {
    if (fix.t === this.last) {
      this.warnings.add('duplicate_fix', line);
      return 'skipped';
    }
    if (fix.t < this.last) {
      this.warnings.add('out_of_order_fix', line);
      return 'skipped';
    }
    if (this.size === this.maxPoints) return 'limit';
    if (this.size === this.columns.t.length) this.grow();

    const i = this.size;
    const c = this.columns;
    c.t[i] = fix.t;
    c.lat[i] = fix.lat;
    c.lon[i] = fix.lon;
    c.altBaro[i] = fix.altBaro;
    c.altGnss[i] = fix.altGnss;
    c.valid[i] = fix.valid;
    c.fxa[i] = fix.fxa;
    c.siu[i] = fix.siu;
    this.size += 1;
    this.last = fix.t;
    return 'added';
  }

  /** Копии ровно нужной длины: отдельные буферы можно передать в другой поток. */
  finish(): TrackColumns {
    const c = this.columns;
    const n = this.size;
    return {
      t: c.t.slice(0, n),
      lat: c.lat.slice(0, n),
      lon: c.lon.slice(0, n),
      altBaro: c.altBaro.slice(0, n),
      altGnss: c.altGnss.slice(0, n),
      valid: c.valid.slice(0, n),
      fxa: c.fxa.slice(0, n),
      siu: c.siu.slice(0, n),
    };
  }

  private grow(): void {
    const c = this.columns;
    const next = allocateColumns(Math.min(c.t.length * GROWTH_FACTOR, this.maxPoints));
    next.t.set(c.t);
    next.lat.set(c.lat);
    next.lon.set(c.lon);
    next.altBaro.set(c.altBaro);
    next.altGnss.set(c.altGnss);
    next.valid.set(c.valid);
    next.fxa.set(c.fxa);
    next.siu.set(c.siu);
    this.columns = next;
  }
}

/** Источник высоты для вариометра и предупреждения об отсутствующих высотах (ТЗ §3.3). */
export function summarizeAltitudes(points: TrackColumns, warnings: WarningLog): AltitudeSource {
  const hasBaro = points.altBaro.some((alt) => !Number.isNaN(alt));
  const hasGnss = points.altGnss.some((alt) => !Number.isNaN(alt));
  if (!hasBaro) warnings.add('no_baro_altitude');
  if (!hasGnss) warnings.add('no_gnss_altitude');
  return hasBaro ? 'baro' : 'gnss';
}

/**
 * Завершение трека, у точек которого полное время (GPX, KML): дата — сутки UTC
 * первой точки. Время сбитого прибора (до 1990 или в будущем) — даты нет, спросить пользователя.
 */
export function finishTimedTrack(
  builder: TrackBuilder,
  meta: TrackMeta,
  warnings: WarningLog,
  now: number,
): ParseResult {
  const points = builder.finish();
  const altitudeSource = summarizeAltitudes(points, warnings);

  const check = checkFixDate(points.t[0] ?? Number.NaN, now);
  if (check.kind === 'ok') {
    meta.date = isoDate(check.dayStart);
    meta.dateSource = 'fix_time';
  } else {
    warnings.add('date_out_of_range');
  }

  return { ok: true, track: { points, meta, warnings: warnings.list(), altitudeSource } };
}
