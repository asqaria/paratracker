/**
 * Бинарный формат `.track` по ТЗ §5.4. Одна реализация: воркер пишет, фронт читает.
 *
 * Структуру нельзя менять без инкремента TRACK_FORMAT_VERSION (CLAUDE.md).
 * Формат little-endian. Колонки выровнены по 8 байт — иначе
 * `new Int32Array(buffer, offset, n)` бросит RangeError при нечётном pointCount.
 */

export const TRACK_MAGIC = 'SKTR';
export const TRACK_FORMAT_VERSION = 1;
export const TRACK_HEADER_BYTES = 64;

/** Биты маски присутствующих каналов (поле fields заголовка). */
export const TRACK_FIELDS = {
  dt: 1 << 0,
  /** dLat и dLon — всегда вместе. */
  position: 1 << 1,
  alt: 1 << 2,
  vSpeed: 1 << 3,
  gSpeed: 1 << 4,
  heading: 1 << 5,
  altAgl: 1 << 6,
  flags: 1 << 7,
} as const;

export interface TrackChannels {
  /** UNIX мс, UTC; строго возрастает. Δt хранится целыми миллисекундами. */
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** Метры; NaN — нет значения. */
  alt?: Float64Array;
  /** м/с; NaN — нет значения. */
  vSpeed?: Float64Array;
  /** м/с, неотрицательная. */
  gSpeed?: Float64Array;
  /** Градусы [0, 360). */
  heading?: Float64Array;
  /** Метры над рельефом. */
  altAgl?: Float64Array;
  /** Биты TRACK_FLAGS. */
  flags?: Uint8Array;
}

export interface TrackGap {
  /** Индекс точки, ПЕРЕД которой был разрыв. */
  index: number;
  durationMs: number;
}

export interface TrackFile {
  version: number;
  pointCount: number;
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  alt?: Float64Array;
  vSpeed?: Float64Array;
  gSpeed?: Float64Array;
  heading?: Float64Array;
  altAgl?: Float64Array;
  flags?: Uint8Array;
  gaps: TrackGap[];
}

type TrackColumnName = 'dt' | 'dLat' | 'dLon' | 'alt' | 'vSpeed' | 'gSpeed' | 'heading' | 'altAgl' | 'flags';

export interface TrackLayout {
  /** Смещения присутствующих колонок от начала буфера. */
  offsets: Record<TrackColumnName, number>;
  /** Размер заголовка и колонок без таблицы разрывов. */
  byteLength: number;
}

interface ColumnSpec {
  name: TrackColumnName;
  bytes: number;
  field: number;
}

/** Порядок колонок в теле файла (ТЗ §5.4). */
const COLUMNS: readonly ColumnSpec[] = [
  { name: 'dt', bytes: 2, field: TRACK_FIELDS.dt },
  { name: 'dLat', bytes: 4, field: TRACK_FIELDS.position },
  { name: 'dLon', bytes: 4, field: TRACK_FIELDS.position },
  { name: 'alt', bytes: 2, field: TRACK_FIELDS.alt },
  { name: 'vSpeed', bytes: 2, field: TRACK_FIELDS.vSpeed },
  { name: 'gSpeed', bytes: 2, field: TRACK_FIELDS.gSpeed },
  { name: 'heading', bytes: 2, field: TRACK_FIELDS.heading },
  { name: 'altAgl', bytes: 2, field: TRACK_FIELDS.altAgl },
  { name: 'flags', bytes: 1, field: TRACK_FIELDS.flags },
];

const HEADER = { version: 4, fields: 6, pointCount: 8, gapCount: 12, t0: 16, lat0: 24, lon0: 32 } as const;
const GAP_ENTRY_BYTES = 8;
const COLUMN_ALIGNMENT = 8;

/** ТЗ §5.4: (lat − lat0) × 1e7 — шаг ≈1.1 см. */
const COORD_SCALE = 1e7;
const SPEED_SCALE = 100;
const HEADING_SCALE = 100;
const HEADING_UNITS = 360 * HEADING_SCALE;
const FULL_TURN_DEG = 360;
const HALF_TURN_DEG = 180;

const INT16_MIN = -32_768;
const INT16_MAX = 32_767;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const UINT16_MAX = 65_535;
const UINT32_MAX = 4_294_967_295;

/** Значения-метки «нет данных»: в ТЗ §5.4 их нет, но NaN бывает (курс на месте, высота без баро). */
const NO_INT16 = INT16_MIN;
const NO_UINT16 = UINT16_MAX;
/** ТЗ §5.4: разрыв дольше потолка Uint16 кодируется как 0xFFFF, длительность — в таблице. */
const GAP_MARKER = 0xffff;
const MAX_INLINE_DT_MS = GAP_MARKER - 1;

/**
 * Потолки колонок (ТЗ §5.4). Значения вне диапазона клипуются при записи:
 * настоящий полёт в них не упирается, а порча соседних колонок переполнением — хуже.
 */
export const TRACK_RANGES = {
  minAltitudeM: INT16_MIN + 1,
  maxAltitudeM: INT16_MAX,
  maxVerticalSpeedMs: INT16_MAX / SPEED_SCALE,
  maxGroundSpeedMs: (UINT16_MAX - 1) / SPEED_SCALE,
} as const;

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function assertLittleEndian(): void {
  if (!LITTLE_ENDIAN) throw new Error('.track is a little-endian format; big-endian platforms are not supported');
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const alignUp = (value: number): number =>
  Math.ceil(value / COLUMN_ALIGNMENT) * COLUMN_ALIGNMENT;

/** Раскладка тела файла: смещение каждой присутствующей колонки, выровненное по 8 байт. */
export function trackLayout(pointCount: number, fields: number): TrackLayout {
  const offsets: Partial<Record<TrackColumnName, number>> = {};
  let cursor = TRACK_HEADER_BYTES;
  for (const column of COLUMNS) {
    if ((fields & column.field) === 0) continue;
    offsets[column.name] = cursor;
    cursor += alignUp(column.bytes * pointCount);
  }
  return { offsets: offsets as Record<TrackColumnName, number>, byteLength: cursor };
}

function assertSameLength(name: string, column: ArrayLike<number> | undefined, pointCount: number): void {
  if (column && column.length !== pointCount) {
    throw new TypeError(`Channel "${name}" has length ${column.length}, expected ${pointCount}`);
  }
}

/** Δt целыми миллисекундами; всё, что не влезло в Uint16, уходит в таблицу разрывов. */
function collectGaps(t: Float64Array): TrackGap[] {
  const gaps: TrackGap[] = [];
  for (let i = 1; i < t.length; i++) {
    const durationMs = Math.round((t[i] ?? 0) - (t[i - 1] ?? 0));
    if (durationMs > MAX_INLINE_DT_MS) gaps.push({ index: i, durationMs });
  }
  return gaps;
}

/**
 * Долгота разворачивается по короткому пути: без этого переход через антимеридиан
 * даёт скачок 360°, который не влезает в Int32 (ТЗ §5.4, delta-of-delta).
 */
function unwrapLongitude(lon: Float64Array): Float64Array {
  const unwrapped = new Float64Array(lon.length);
  let previous = lon[0] ?? 0;
  let value = previous;
  for (let i = 0; i < lon.length; i++) {
    const current = lon[i] ?? 0;
    let delta = current - previous;
    if (delta > HALF_TURN_DEG) delta -= FULL_TURN_DEG;
    else if (delta < -HALF_TURN_DEG) delta += FULL_TURN_DEG;
    value = i === 0 ? current : value + delta;
    unwrapped[i] = value;
    previous = current;
  }
  return unwrapped;
}

/** Абсолютные смещения в единицах 1e-7° → колонка вторых разностей. */
function encodeDeltaOfDelta(values: Float64Array, origin: number, out: Int32Array): void {
  let previousAbsolute = 0;
  let previousDelta = 0;
  for (let i = 0; i < values.length; i++) {
    const absolute = Math.round(((values[i] ?? 0) - origin) * COORD_SCALE);
    if (i === 0) {
      out[i] = clamp(absolute, INT32_MIN, INT32_MAX);
    } else {
      const delta = absolute - previousAbsolute;
      out[i] = clamp(i === 1 ? delta : delta - previousDelta, INT32_MIN, INT32_MAX);
      previousDelta = delta;
    }
    previousAbsolute = absolute;
  }
}

function decodeDeltaOfDelta(column: Int32Array, origin: number, out: Float64Array): void {
  let absolute = 0;
  let delta = 0;
  for (let i = 0; i < column.length; i++) {
    const encoded = column[i] ?? 0;
    if (i === 0) absolute = encoded;
    else {
      delta = i === 1 ? encoded : delta + encoded;
      absolute += delta;
    }
    out[i] = origin + absolute / COORD_SCALE;
  }
}

const normalizeLongitude = (lon: number): number => {
  const wrapped = ((lon + HALF_TURN_DEG) % FULL_TURN_DEG + FULL_TURN_DEG) % FULL_TURN_DEG - HALF_TURN_DEG;
  return wrapped === -HALF_TURN_DEG ? HALF_TURN_DEG : wrapped;
};

const encodeInt16 = (value: number, scale: number): number =>
  Number.isNaN(value) ? NO_INT16 : clamp(Math.round(value * scale), INT16_MIN + 1, INT16_MAX);

const decodeInt16 = (value: number, scale: number): number => (value === NO_INT16 ? Number.NaN : value / scale);

const encodeUint16 = (value: number, scale: number): number =>
  Number.isNaN(value) ? NO_UINT16 : clamp(Math.round(value * scale), 0, UINT16_MAX - 1);

const decodeUint16 = (value: number, scale: number): number => (value === NO_UINT16 ? Number.NaN : value / scale);

export function writeTrack(channels: TrackChannels): ArrayBuffer {
  assertLittleEndian();
  const pointCount = channels.t.length;
  for (const [name, column] of Object.entries(channels)) {
    if (name !== 't') assertSameLength(name, column as ArrayLike<number> | undefined, pointCount);
  }

  const fields =
    TRACK_FIELDS.dt |
    TRACK_FIELDS.position |
    (channels.alt ? TRACK_FIELDS.alt : 0) |
    (channels.vSpeed ? TRACK_FIELDS.vSpeed : 0) |
    (channels.gSpeed ? TRACK_FIELDS.gSpeed : 0) |
    (channels.heading ? TRACK_FIELDS.heading : 0) |
    (channels.altAgl ? TRACK_FIELDS.altAgl : 0) |
    (channels.flags ? TRACK_FIELDS.flags : 0);

  const gaps = collectGaps(channels.t);
  const layout = trackLayout(pointCount, fields);
  const buffer = new ArrayBuffer(layout.byteLength + gaps.length * GAP_ENTRY_BYTES);
  const header = new DataView(buffer);

  for (let i = 0; i < TRACK_MAGIC.length; i++) header.setUint8(i, TRACK_MAGIC.charCodeAt(i));
  header.setUint16(HEADER.version, TRACK_FORMAT_VERSION, true);
  header.setUint16(HEADER.fields, fields, true);
  header.setUint32(HEADER.pointCount, pointCount, true);
  header.setUint16(HEADER.gapCount, gaps.length, true);
  header.setFloat64(HEADER.t0, channels.t[0] ?? 0, true);
  header.setFloat64(HEADER.lat0, channels.lat[0] ?? 0, true);
  header.setFloat64(HEADER.lon0, channels.lon[0] ?? 0, true);

  const dt = new Uint16Array(buffer, layout.offsets.dt, pointCount);
  for (let i = 1; i < pointCount; i++) {
    const step = Math.round((channels.t[i] ?? 0) - (channels.t[i - 1] ?? 0));
    dt[i] = step > MAX_INLINE_DT_MS ? GAP_MARKER : clamp(step, 0, MAX_INLINE_DT_MS);
  }

  encodeDeltaOfDelta(channels.lat, channels.lat[0] ?? 0, new Int32Array(buffer, layout.offsets.dLat, pointCount));
  encodeDeltaOfDelta(
    unwrapLongitude(channels.lon),
    channels.lon[0] ?? 0,
    new Int32Array(buffer, layout.offsets.dLon, pointCount),
  );

  if (channels.alt) {
    const column = new Int16Array(buffer, layout.offsets.alt, pointCount);
    for (let i = 0; i < pointCount; i++) column[i] = encodeInt16(channels.alt[i] ?? Number.NaN, 1);
  }
  if (channels.vSpeed) {
    const column = new Int16Array(buffer, layout.offsets.vSpeed, pointCount);
    for (let i = 0; i < pointCount; i++) column[i] = encodeInt16(channels.vSpeed[i] ?? Number.NaN, SPEED_SCALE);
  }
  if (channels.gSpeed) {
    const column = new Uint16Array(buffer, layout.offsets.gSpeed, pointCount);
    for (let i = 0; i < pointCount; i++) column[i] = encodeUint16(channels.gSpeed[i] ?? Number.NaN, SPEED_SCALE);
  }
  if (channels.heading) {
    const column = new Uint16Array(buffer, layout.offsets.heading, pointCount);
    for (let i = 0; i < pointCount; i++) {
      const value = channels.heading[i] ?? Number.NaN;
      column[i] = Number.isNaN(value)
        ? NO_UINT16
        : ((Math.round(value * HEADING_SCALE) % HEADING_UNITS) + HEADING_UNITS) % HEADING_UNITS;
    }
  }
  if (channels.altAgl) {
    const column = new Int16Array(buffer, layout.offsets.altAgl, pointCount);
    for (let i = 0; i < pointCount; i++) column[i] = encodeInt16(channels.altAgl[i] ?? Number.NaN, 1);
  }
  if (channels.flags) new Uint8Array(buffer, layout.offsets.flags, pointCount).set(channels.flags);

  for (let g = 0; g < gaps.length; g++) {
    const gap = gaps[g];
    const at = layout.byteLength + g * GAP_ENTRY_BYTES;
    header.setUint32(at, gap?.index ?? 0, true);
    header.setUint32(at + 4, clamp(gap?.durationMs ?? 0, 0, UINT32_MAX), true);
  }

  return buffer;
}

export function readTrack(source: ArrayBuffer | Uint8Array): TrackFile {
  assertLittleEndian();
  let bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  // Виды Int32/Float64 требуют выровненного смещения — чужой подмассив копируем.
  if (bytes.byteOffset % COLUMN_ALIGNMENT !== 0) bytes = Uint8Array.from(bytes);

  if (bytes.byteLength < TRACK_HEADER_BYTES) {
    throw new Error(`.track is truncated: header needs ${TRACK_HEADER_BYTES} bytes, got ${bytes.byteLength}`);
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const magic = String.fromCharCode(...bytes.subarray(0, TRACK_MAGIC.length));
  if (magic !== TRACK_MAGIC) throw new Error(`Not a .track file: magic "${magic}", expected "${TRACK_MAGIC}"`);
  const version = header.getUint16(HEADER.version, true);
  if (version !== TRACK_FORMAT_VERSION) {
    throw new Error(`Unsupported .track version ${version}, expected ${TRACK_FORMAT_VERSION}`);
  }

  const fields = header.getUint16(HEADER.fields, true);
  const pointCount = header.getUint32(HEADER.pointCount, true);
  const gapCount = header.getUint16(HEADER.gapCount, true);
  const t0 = header.getFloat64(HEADER.t0, true);
  const lat0 = header.getFloat64(HEADER.lat0, true);
  const lon0 = header.getFloat64(HEADER.lon0, true);

  const layout = trackLayout(pointCount, fields);
  const needed = layout.byteLength + gapCount * GAP_ENTRY_BYTES;
  if (bytes.byteLength < needed) {
    throw new Error(`.track is truncated: expected ${needed} bytes, got ${bytes.byteLength}`);
  }

  const gaps: TrackGap[] = [];
  const gapDurations = new Map<number, number>();
  for (let g = 0; g < gapCount; g++) {
    const at = layout.byteLength + g * GAP_ENTRY_BYTES;
    const gap = { index: header.getUint32(at, true), durationMs: header.getUint32(at + 4, true) };
    gaps.push(gap);
    gapDurations.set(gap.index, gap.durationMs);
  }

  const base = bytes.byteOffset;
  const t = new Float64Array(pointCount);
  const dt = new Uint16Array(bytes.buffer, base + layout.offsets.dt, pointCount);
  let time = t0;
  for (let i = 0; i < pointCount; i++) {
    if (i > 0) time += dt[i] === GAP_MARKER ? (gapDurations.get(i) ?? 0) : (dt[i] ?? 0);
    t[i] = time;
  }

  const lat = new Float64Array(pointCount);
  const lon = new Float64Array(pointCount);
  decodeDeltaOfDelta(new Int32Array(bytes.buffer, base + layout.offsets.dLat, pointCount), lat0, lat);
  decodeDeltaOfDelta(new Int32Array(bytes.buffer, base + layout.offsets.dLon, pointCount), lon0, lon);
  for (let i = 0; i < pointCount; i++) lon[i] = normalizeLongitude(lon[i] ?? 0);

  const file: TrackFile = { version, pointCount, t, lat, lon, gaps };

  const readInt16 = (offset: number, scale: number): Float64Array => {
    const column = new Int16Array(bytes.buffer, base + offset, pointCount);
    return Float64Array.from(column, (value) => decodeInt16(value, scale));
  };
  const readUint16 = (offset: number, scale: number): Float64Array => {
    const column = new Uint16Array(bytes.buffer, base + offset, pointCount);
    return Float64Array.from(column, (value) => decodeUint16(value, scale));
  };

  if ((fields & TRACK_FIELDS.alt) !== 0) file.alt = readInt16(layout.offsets.alt, 1);
  if ((fields & TRACK_FIELDS.vSpeed) !== 0) file.vSpeed = readInt16(layout.offsets.vSpeed, SPEED_SCALE);
  if ((fields & TRACK_FIELDS.gSpeed) !== 0) file.gSpeed = readUint16(layout.offsets.gSpeed, SPEED_SCALE);
  if ((fields & TRACK_FIELDS.heading) !== 0) file.heading = readUint16(layout.offsets.heading, HEADING_SCALE);
  if ((fields & TRACK_FIELDS.altAgl) !== 0) file.altAgl = readInt16(layout.offsets.altAgl, 1);
  if ((fields & TRACK_FIELDS.flags) !== 0) {
    file.flags = Uint8Array.from(new Uint8Array(bytes.buffer, base + layout.offsets.flags, pointCount));
  }

  return file;
}
