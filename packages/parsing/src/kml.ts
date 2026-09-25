import type { GnssAltitudeDatum, ParseFailureCode, ParseResult } from '@skyline/core';
import { unzipSync } from 'fflate';

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
import { lineLocator, scanXml, type XmlHandler } from './xml.js';

/**
 * Парсер KML/KMZ (ТЗ §3.1): только gx:Track и LineString.
 * gx:Track несёт время каждой точки. У LineString времени нет — оно берётся из
 * TimeSpan метки и распределяется равномерно (с предупреждением); без TimeSpan
 * трек не проиграть, файл отклоняется. Если в файле есть gx:Track — LineString
 * игнорируются: Google Earth кладёт рядом тот же путь без времени.
 */

/** Сигнатура локального заголовка ZIP: `PK\x03\x04`. */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;
/** KML: altitudeMode absolute — «relative to sea level» (OGC KML 2.2), EGM96. */
const KML_ALTITUDE_DATUM: GnssAltitudeDatum = 'geoid';
const KMZ_MAIN_DOCUMENT = 'doc.kml';
const KML_EXTENSION = '.kml';
const ABSOLUTE_ALTITUDE = 'absolute';

interface Segment {
  t: number[];
  lat: number[];
  lon: number[];
  alt: number[];
  line: number;
}

interface OpenTrack {
  whens: { t: number; offset: number }[];
  coords: { lat: number; lon: number; alt: number; offset: number }[];
  altitudeMode: string | null;
  line: number;
}

interface OpenLineString {
  coordinates: string;
  altitudeMode: string | null;
  line: number;
}

interface OpenPlacemark {
  lineStrings: OpenLineString[];
  begin: number;
  end: number;
}

const emptySegment = (line: number): Segment => ({ t: [], lat: [], lon: [], alt: [], line });

/** Высота абсолютная, если режим не задан явно иначе. */
const isAbsolute = (mode: string | null): boolean => mode === null || mode === ABSOLUTE_ALTITUDE;

class KmlReader implements XmlHandler {
  /** Сегменты gx:Track. */
  readonly tracks: Segment[] = [];
  /** Сегменты LineString с временем из TimeSpan. */
  readonly interpolated: Segment[] = [];
  /** Геометрии, для которых нет времени. */
  untimedGeometries = 0;

  private readonly path: string[] = [];
  private track: OpenTrack | null = null;
  private lineString: OpenLineString | null = null;
  private placemark: OpenPlacemark | null = null;
  private multiTrackAltitudeMode: string | null = null;
  private collecting: { element: string; offset: number } | null = null;
  private buffer = '';
  private readonly warnings: WarningLog;
  private readonly lineAt: (offset: number) => number;

  constructor(warnings: WarningLog, lineAt: (offset: number) => number) {
    this.warnings = warnings;
    this.lineAt = lineAt;
  }

  get collectingText(): boolean {
    return this.collecting !== null;
  }

  get unclosed(): boolean {
    return this.path.length > 0;
  }

  open(name: string, _attributes: string, offset: number): void {
    const parent = this.path.at(-1);
    this.path.push(name);

    switch (name) {
      case 'Placemark':
        this.placemark = { lineStrings: [], begin: Number.NaN, end: Number.NaN };
        break;
      case 'MultiTrack':
        this.multiTrackAltitudeMode = null;
        break;
      case 'Track':
        this.track = { whens: [], coords: [], altitudeMode: null, line: this.lineAt(offset) };
        break;
      case 'LineString':
        this.lineString = { coordinates: '', altitudeMode: null, line: this.lineAt(offset) };
        break;
      case 'when':
      case 'coord':
        if (this.track && parent === 'Track') this.startCollect(name, offset);
        break;
      case 'coordinates':
        if (this.lineString && parent === 'LineString') this.startCollect(name, offset);
        break;
      case 'altitudeMode':
        if (parent === 'Track' || parent === 'LineString' || parent === 'MultiTrack') this.startCollect(name, offset);
        break;
      case 'begin':
      case 'end':
        if (this.placemark && parent === 'TimeSpan') this.startCollect(name, offset);
        break;
    }
  }

  text(value: string): void {
    this.buffer += value;
  }

  close(name: string): void {
    const index = this.path.lastIndexOf(name);
    if (index !== -1) this.path.length = index;

    if (this.collecting?.element === name) {
      this.finishText(name, this.buffer, this.collecting.offset, this.path.at(-1));
      this.collecting = null;
      this.buffer = '';
    }

    switch (name) {
      case 'Track':
        if (this.track) this.finishTrack(this.track);
        this.track = null;
        break;
      case 'LineString':
        if (this.lineString) {
          if (this.placemark) this.placemark.lineStrings.push(this.lineString);
          else this.untimedGeometries += 1;
        }
        this.lineString = null;
        break;
      case 'MultiTrack':
        this.multiTrackAltitudeMode = null;
        break;
      case 'Placemark':
        if (this.placemark) this.finishPlacemark(this.placemark);
        this.placemark = null;
        break;
    }
  }

  /** Конец документа: оборванный gx:Track и метка — всё, что успело записаться. */
  finishOpen(): void {
    if (this.track) this.finishTrack(this.track);
    if (this.placemark) this.finishPlacemark(this.placemark);
    this.track = null;
    this.placemark = null;
  }

  private startCollect(element: string, offset: number): void {
    this.collecting = { element, offset };
    this.buffer = '';
  }

  private finishText(name: string, value: string, offset: number, parent: string | undefined): void {
    switch (name) {
      case 'when':
        this.track?.whens.push({ t: parseIsoTime(value), offset });
        break;
      case 'coord': {
        // gx:coord — «долгота широта высота» через пробел.
        const [lon, lat, alt] = value.trim().split(/\s+/);
        this.track?.coords.push({ lon: parseDecimal(lon), lat: parseDecimal(lat), alt: parseDecimal(alt), offset });
        break;
      }
      case 'coordinates':
        if (this.lineString) this.lineString.coordinates += value;
        break;
      case 'altitudeMode': {
        const mode = value.trim();
        if (parent === 'Track' && this.track) this.track.altitudeMode = mode;
        else if (parent === 'LineString' && this.lineString) this.lineString.altitudeMode = mode;
        else if (parent === 'MultiTrack') this.multiTrackAltitudeMode = mode;
        break;
      }
      case 'begin':
        if (this.placemark) this.placemark.begin = parseIsoTime(value);
        break;
      case 'end':
        if (this.placemark) this.placemark.end = parseIsoTime(value);
        break;
    }
  }

  private finishTrack(track: OpenTrack): void {
    const { whens, coords } = track;
    if (whens.length !== coords.length) this.warnings.add('track_length_mismatch', track.line);

    const keepAltitude = isAbsolute(track.altitudeMode ?? this.multiTrackAltitudeMode);
    const segment = emptySegment(track.line);
    let droppedAltitude = false;

    for (let i = 0; i < Math.min(whens.length, coords.length); i++) {
      const when = whens[i];
      const coord = coords[i];
      if (!when || !coord) continue;
      if (Number.isNaN(when.t) || !isValidCoordinate(coord.lat, coord.lon)) {
        this.warnings.add('malformed_fix', this.lineAt(Number.isNaN(when.t) ? when.offset : coord.offset));
        continue;
      }
      if (!keepAltitude && !Number.isNaN(coord.alt)) droppedAltitude = true;
      segment.t.push(when.t);
      segment.lat.push(coord.lat);
      segment.lon.push(coord.lon);
      segment.alt.push(keepAltitude ? coord.alt : Number.NaN);
    }

    if (droppedAltitude) this.warnings.add('altitude_not_absolute', track.line);
    if (segment.t.length > 0) this.tracks.push(segment);
    else if (coords.length > 0) this.untimedGeometries += 1;
  }

  private finishPlacemark(placemark: OpenPlacemark): void {
    const { lineStrings, begin, end } = placemark;
    const first = lineStrings[0];
    if (!first) return;

    const segment = emptySegment(first.line);
    let droppedAltitude = false;
    for (const lineString of lineStrings) {
      const keepAltitude = isAbsolute(lineString.altitudeMode);
      // coordinates — кортежи «долгота,широта[,высота]» через пробельные символы.
      for (const tuple of lineString.coordinates.trim().split(/\s+/)) {
        if (tuple === '') continue;
        const [lon, lat, alt] = tuple.split(',').map(parseDecimal);
        if (lon === undefined || lat === undefined || Number.isNaN(lon) || Number.isNaN(lat) || !isValidCoordinate(lat, lon)) {
          this.warnings.add('malformed_fix', lineString.line);
          continue;
        }
        const altitude = alt ?? Number.NaN;
        if (!keepAltitude && !Number.isNaN(altitude)) droppedAltitude = true;
        segment.lat.push(lat);
        segment.lon.push(lon);
        segment.alt.push(keepAltitude ? altitude : Number.NaN);
      }
    }

    const n = segment.lat.length;
    if (n === 0) return;
    const hasTimeSpan = Number.isFinite(begin) && Number.isFinite(end) && (n === 1 ? end >= begin : end > begin);
    if (!hasTimeSpan) {
      this.untimedGeometries += lineStrings.length;
      return;
    }

    for (let i = 0; i < n; i++) {
      segment.t.push(n === 1 ? begin : begin + ((end - begin) * i) / (n - 1));
    }
    if (droppedAltitude) this.warnings.add('altitude_not_absolute', first.line);
    this.interpolated.push(segment);
  }
}

function isZip(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

type Extracted = { ok: true; text: string } | { ok: false; code: ParseFailureCode };

/** KMZ: doc.kml, а если его нет — первый .kml в архиве. Размер распакованного — в пределах лимита. */
function extractKml(archive: Uint8Array, maxBytes: number): Extracted {
  try {
    const entries: { name: string; originalSize: number }[] = [];
    unzipSync(archive, {
      filter: (file) => {
        entries.push({ name: file.name, originalSize: file.originalSize });
        return false;
      },
    });

    const chosen =
      entries.find((entry) => entry.name.toLowerCase() === KMZ_MAIN_DOCUMENT) ??
      entries.find((entry) => entry.name.toLowerCase().endsWith(KML_EXTENSION));
    if (!chosen) return { ok: false, code: 'invalid_archive' };
    // Размер из заголовка — до распаковки: защита от zip-бомбы.
    if (chosen.originalSize > maxBytes) return { ok: false, code: 'file_too_large' };

    const data = unzipSync(archive, { filter: (file) => file.name === chosen.name })[chosen.name];
    if (!data) return { ok: false, code: 'invalid_archive' };
    if (data.byteLength > maxBytes) return { ok: false, code: 'file_too_large' };
    return { ok: true, text: decodeUtf8(data) };
  } catch {
    return { ok: false, code: 'invalid_archive' };
  }
}

export function parseKml(input: string | Uint8Array, options: ParseOptions): ParseResult {
  const limits = resolveLimits(options);
  if (inputSize(input) > limits.maxFileBytes) return { ok: false, code: 'file_too_large', warnings: [] };

  let text: string;
  if (typeof input === 'string') {
    text = input;
  } else if (isZip(input)) {
    const extracted = extractKml(input, limits.maxFileBytes);
    if (!extracted.ok) return { ok: false, code: extracted.code, warnings: [] };
    text = extracted.text;
  } else {
    text = decodeUtf8(input);
  }
  text = stripBom(text);

  const warnings = new WarningLog();
  const reader = new KmlReader(warnings, lineLocator(text));
  scanXml(text, reader);
  if (reader.unclosed) warnings.add('truncated_document');
  reader.finishOpen();

  const useTracks = reader.tracks.length > 0;
  const segments = useTracks ? reader.tracks : reader.interpolated;
  if (segments.length === 0) {
    return { ok: false, code: reader.untimedGeometries > 0 ? 'no_timestamps' : 'no_fixes', warnings: warnings.list() };
  }
  if (!useTracks) for (const segment of segments) warnings.add('timestamps_interpolated', segment.line);

  const total = segments.reduce((sum, segment) => sum + segment.t.length, 0);
  const builder = new TrackBuilder({ maxPoints: limits.maxPoints, warnings, initialCapacity: total });
  // Сегменты склеиваются по времени, а не по порядку в документе.
  const ordered = [...segments].sort((a, b) => (a.t[0] ?? 0) - (b.t[0] ?? 0));
  for (const segment of ordered) {
    for (let i = 0; i < segment.t.length; i++) {
      const result = builder.push(
        {
          t: segment.t[i] ?? Number.NaN,
          lat: segment.lat[i] ?? Number.NaN,
          lon: segment.lon[i] ?? Number.NaN,
          altBaro: Number.NaN,
          altGnss: segment.alt[i] ?? Number.NaN,
          valid: 1,
          fxa: Number.NaN,
          siu: Number.NaN,
        },
        segment.line,
      );
      if (result === 'limit') return { ok: false, code: 'too_many_points', warnings: warnings.list() };
    }
  }

  return finishTimedTrack(builder, { date: null, dateSource: null }, warnings, options.now, KML_ALTITUDE_DATUM);
}
