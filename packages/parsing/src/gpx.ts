import type { ParseResult, TrackMeta } from '@skyline/core';

import { parseIsoTime } from './dates.js';
import { decodeUtf8, inputSize, parseDecimal, stripBom } from './text.js';
import {
  finishTimedTrack,
  isValidCoordinate,
  resolveLimits,
  TrackBuilder,
  WarningLog,
  type ParseOptions,
} from './track-builder.js';
import { lineLocator, readAttributes, scanXml, type XmlHandler } from './xml.js';

/**
 * Парсер GPX (ТЗ §3.1): точки trkpt, время из <time>, высота из <ele>.
 * Баровысоты в GPX нет — altitudeSource 'gnss'. Маршруты (rte) и путевые точки (wpt) не трек.
 */

/** Дочерние элементы trkpt, текст которых нужен. */
const POINT_FIELDS = new Set(['ele', 'time', 'fix', 'sat']);
/** GPX <fix>: none и 2d — не 3D-фикс. */
const NOT_3D_FIXES = new Set(['none', '2d']);

interface PendingPoint {
  lat: number;
  lon: number;
  line: number;
  fields: Map<string, string>;
}

class GpxReader implements XmlHandler {
  readonly meta: TrackMeta = { date: null, dateSource: null };
  pointsSeen = 0;
  pointsWithTime = 0;
  overLimit = false;

  private readonly path: string[] = [];
  private point: PendingPoint | null = null;
  private collect: { element: string; target: 'point' | 'pilot' } | null = null;
  private buffer = '';
  private readonly builder: TrackBuilder;
  private readonly warnings: WarningLog;
  private readonly lineAt: (offset: number) => number;

  constructor(builder: TrackBuilder, warnings: WarningLog, lineAt: (offset: number) => number) {
    this.builder = builder;
    this.warnings = warnings;
    this.lineAt = lineAt;
  }

  get collectingText(): boolean {
    return this.collect !== null;
  }

  /** Документ кончился с незакрытыми элементами. */
  get unclosed(): boolean {
    return this.path.length > 0;
  }

  open(name: string, attributes: string, offset: number): void {
    if (this.overLimit) return;
    const parent = this.path.at(-1);
    this.path.push(name);

    if (name === 'gpx' && parent === undefined) {
      const creator = readAttributes(attributes).get('creator')?.trim();
      if (creator) this.meta.device ??= creator;
    } else if (name === 'trkpt') {
      // Незакрытая предыдущая точка — битая.
      if (this.point) this.warnings.add('malformed_fix', this.point.line);
      const attrs = readAttributes(attributes);
      this.point = {
        lat: parseDecimal(attrs.get('lat')),
        lon: parseDecimal(attrs.get('lon')),
        line: this.lineAt(offset),
        fields: new Map(),
      };
    } else if (this.point && parent === 'trkpt' && POINT_FIELDS.has(name)) {
      this.startCollect(name, 'point');
    } else if (this.isAuthorName()) {
      this.startCollect(name, 'pilot');
    }
  }

  text(value: string): void {
    this.buffer += value;
  }

  close(name: string): void {
    if (this.overLimit) return;
    const index = this.path.lastIndexOf(name);
    if (index !== -1) this.path.length = index;

    if (this.collect?.element === name) {
      const value = this.buffer.trim();
      if (this.collect.target === 'pilot') {
        if (value) this.meta.pilot ??= value;
      } else {
        this.point?.fields.set(name, value);
      }
      this.collect = null;
      this.buffer = '';
    }

    if (name === 'trkpt' && this.point) {
      this.finishPoint(this.point);
      this.point = null;
    }
  }

  private startCollect(element: string, target: 'point' | 'pilot'): void {
    this.collect = { element, target };
    this.buffer = '';
  }

  /** GPX 1.1: metadata/author/name; GPX 1.0: gpx/author — текст. */
  private isAuthorName(): boolean {
    const [a, b, c] = [this.path.at(-1), this.path.at(-2), this.path.at(-3)];
    return (a === 'name' && b === 'author' && c === 'metadata') || (a === 'author' && b === 'gpx' && c === undefined);
  }

  private finishPoint(point: PendingPoint): void {
    this.pointsSeen += 1;
    const time = point.fields.get('time');
    const t = time === undefined ? Number.NaN : parseIsoTime(time);
    if (!Number.isNaN(t)) this.pointsWithTime += 1;

    if (Number.isNaN(t) || !isValidCoordinate(point.lat, point.lon)) {
      this.warnings.add('malformed_fix', point.line);
      return;
    }

    const fix = point.fields.get('fix')?.toLowerCase();
    const result = this.builder.push(
      {
        t,
        lat: point.lat,
        lon: point.lon,
        altBaro: Number.NaN,
        altGnss: parseDecimal(point.fields.get('ele')),
        valid: fix !== undefined && NOT_3D_FIXES.has(fix) ? 0 : 1,
        fxa: Number.NaN,
        siu: parseDecimal(point.fields.get('sat')),
      },
      point.line,
    );
    if (result === 'limit') this.overLimit = true;
  }
}

export function parseGpx(input: string | Uint8Array, options: ParseOptions): ParseResult {
  const limits = resolveLimits(options);
  if (inputSize(input) > limits.maxFileBytes) return { ok: false, code: 'file_too_large', warnings: [] };

  const text = stripBom(typeof input === 'string' ? input : decodeUtf8(input));
  const warnings = new WarningLog();
  const builder = new TrackBuilder({ maxPoints: limits.maxPoints, warnings });
  const reader = new GpxReader(builder, warnings, lineLocator(text));
  scanXml(text, reader);

  if (reader.overLimit) return { ok: false, code: 'too_many_points', warnings: warnings.list() };
  if (reader.unclosed) warnings.add('truncated_document');
  if (builder.count === 0) {
    const code = reader.pointsSeen > 0 && reader.pointsWithTime === 0 ? 'no_timestamps' : 'no_fixes';
    return { ok: false, code, warnings: warnings.list() };
  }

  return finishTimedTrack(builder, reader.meta, warnings, options.now);
}
