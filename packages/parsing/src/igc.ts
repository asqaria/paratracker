import {
  IGC,
  TIME,
  type DateSource,
  type ParsedTrack,
  type ParseResult,
  type ParseWarning,
  type ParseWarningCode,
  type TrackColumns,
  type TrackMeta,
} from '@skyline/core';

/**
 * Парсер IGC по ТЗ §3.3. Чистая функция: на входе строка или байты, на выходе
 * ParsedTrack. Ни сети, ни файловой системы, ни текущего времени — «сейчас»
 * передаётся параметром. На кривой строке не бросает: пишет предупреждение и идёт дальше.
 */

export interface ParseLimits {
  maxFileBytes: number;
  maxPoints: number;
}

export interface IgcParseOptions {
  /** «Сейчас», UNIX мс — для санити-чека даты (не в будущем). Параметр, а не Date.now(): парсер детерминирован. */
  now: number;
  /** Имя загруженного файла — запасной источник даты (ТЗ §3.3). */
  fileName?: string;
  /** Переопределение лимитов ТЗ §3.3. */
  limits?: Partial<ParseLimits>;
}

/** Раскладка B-записи, ТЗ §3.3. Позиции 1-based, границы включительно. */
const B = {
  hours: { from: 2, to: 3 },
  minutes: { from: 4, to: 5 },
  seconds: { from: 6, to: 7 },
  latDegrees: { from: 8, to: 9 },
  /** MMmmm — минуты в тысячных. */
  latMinutes: { from: 10, to: 14 },
  latHemisphere: 15,
  lonDegrees: { from: 16, to: 18 },
  lonMinutes: { from: 19, to: 23 },
  lonHemisphere: 24,
  validity: 25,
  altBaro: { from: 26, to: 30 },
  altGnss: { from: 31, to: 35 },
  /** Расширения по I-записи — с этого байта. */
  firstExtensionByte: 36,
} as const;
const B_RECORD_MIN_LENGTH = B.altGnss.to;

/** I-запись: `I NN SSFFCCC SSFFCCC…`, позиции 1-based. */
const I = {
  count: { from: 2, to: 3 },
  firstGroupAt: 4,
  /** SS + FF + CCC */
  groupLength: 7,
  codeLength: 3,
} as const;

/** Коды расширений B-записи, которые попадают в трек. */
const EXTENSION = { accuracy: 'FXA', satellites: 'SIU', latDigits: 'LAD', lonDigits: 'LOD' } as const;

/** IGC: код датума 100 — WGS-1984 (старый формат HFDTM100 без текста). */
const DATUM_CODE_WGS84 = '100';

const HEADER_FIELDS = {
  PLT: 'pilot',
  GTY: 'glider',
  GID: 'gliderId',
  FTY: 'device',
  SIT: 'site',
} as const satisfies Record<string, keyof TrackMeta>;
type TextMetaKey = (typeof HEADER_FIELDS)[keyof typeof HEADER_FIELDS] | 'logger';

/** Типы записей IGC, которые в Фазе 1 не нужны, но и предупреждения не заслуживают. */
const IGNORED_RECORDS = new Set(['C', 'D', 'E', 'F', 'J', 'K', 'L']);

const MINUTE_THOUSANDTHS = 1000;
const MINUTES_PER_DEGREE = 60;
const MAX_MINUTE_THOUSANDTHS = MINUTES_PER_DEGREE * MINUTE_THOUSANDTHS;
const MAX_LAT_DEGREES = 90;
const MAX_LON_DEGREES = 180;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = MINUTES_PER_HOUR * SECONDS_PER_MINUTE;
const DECIMAL_BASE = 10;
const CHAR_CODE_ZERO = 48;
const CENTURY_20 = 1900;
const CENTURY_21 = 2000;
/** Короткое имя IGC кодирует месяц и день одним символом base-36 (1–9, A–V). */
const SHORT_NAME_RADIX = 36;
/** String.fromCharCode принимает ограниченное число аргументов — декодируем кусками. */
const DECODE_CHUNK_BYTES = 0x8000;

const LINE_BREAK = /\r\n|\r|\n/;
const UTF8_BOM_AS_LATIN1 = 'ï»¿';
const BOM = '﻿';
const DDMMYY = /^(\d{2})(\d{2})(\d{2})/;
/** Длинное имя IGC: `YYYY-MM-DD-MMM-SSSSSS-FF.IGC`. */
const LONG_FILE_NAME = /^(\d{4})-(\d{2})-(\d{2})-/;
/** Короткое имя IGC: `YMDCXXXF.IGC` — последняя цифра года, месяц и день в base-36. */
const SHORT_FILE_NAME = /^(\d)([1-9A-C])([1-9A-V])[0-9A-Z]{5}\.IGC$/i;

interface Extension {
  code: string;
  from: number;
  to: number;
}

interface Fix {
  secondOfDay: number;
  lat: number;
  lon: number;
  altBaro: number;
  altGnss: number;
  valid: number;
  fxa: number;
  siu: number;
}

/** Дополнительные знаки минут из LAD/LOD. */
interface ExtraDigits {
  value: number;
  digits: number;
}

class WarningLog {
  private readonly items: ParseWarning[] = [];
  private truncated = false;

  add(code: ParseWarningCode, line?: number): void {
    if (this.items.length >= IGC.maxWarnings) {
      this.truncated = true;
      return;
    }
    this.items.push(line === undefined ? { code } : { code, line });
  }

  list(): ParseWarning[] {
    return this.truncated ? [...this.items, { code: 'warnings_truncated' }] : [...this.items];
  }
}

/** Целое из цифр в позициях [from, to] (1-based); NaN, если не цифры или строка короче. */
function readDigits(line: string, from: number, to: number): number {
  let value = 0;
  for (let i = from - 1; i < to; i++) {
    const digit = line.charCodeAt(i) - CHAR_CODE_ZERO;
    if (!(digit >= 0 && digit < DECIMAL_BASE)) return Number.NaN;
    value = value * DECIMAL_BASE + digit;
  }
  return value;
}

/** Высота: `NNNNN` или `-NNNN` (ТЗ §3.3). */
function readAltitude(line: string, field: { from: number; to: number }): number {
  return line[field.from - 1] === '-'
    ? -readDigits(line, field.from + 1, field.to)
    : readDigits(line, field.from, field.to);
}

/** ТЗ §3.3: DD + (MMmmm / 1000) / 60; LAD/LOD дописывают знаки минут справа. */
function coordinate(degrees: number, thousandths: number, extra: ExtraDigits | null, negative: boolean): number {
  let minutes = thousandths;
  let scale = MINUTE_THOUSANDTHS;
  if (extra) {
    const shift = DECIMAL_BASE ** extra.digits;
    minutes = thousandths * shift + extra.value;
    scale *= shift;
  }
  const value = degrees + minutes / scale / MINUTES_PER_DEGREE;
  return negative ? -value : value;
}

function readFix(line: string, extensions: readonly Extension[]): Fix | null {
  if (line.length < B_RECORD_MIN_LENGTH) return null;

  const hours = readDigits(line, B.hours.from, B.hours.to);
  const minutes = readDigits(line, B.minutes.from, B.minutes.to);
  const seconds = readDigits(line, B.seconds.from, B.seconds.to);
  if (!(hours < HOURS_PER_DAY && minutes < MINUTES_PER_HOUR && seconds < SECONDS_PER_MINUTE)) return null;

  const latHemisphere = line[B.latHemisphere - 1];
  const lonHemisphere = line[B.lonHemisphere - 1];
  if ((latHemisphere !== 'N' && latHemisphere !== 'S') || (lonHemisphere !== 'E' && lonHemisphere !== 'W')) {
    return null;
  }

  const latDegrees = readDigits(line, B.latDegrees.from, B.latDegrees.to);
  const latMinutes = readDigits(line, B.latMinutes.from, B.latMinutes.to);
  const lonDegrees = readDigits(line, B.lonDegrees.from, B.lonDegrees.to);
  const lonMinutes = readDigits(line, B.lonMinutes.from, B.lonMinutes.to);
  if (!(latMinutes < MAX_MINUTE_THOUSANDTHS && lonMinutes < MAX_MINUTE_THOUSANDTHS)) return null;

  const validity = line[B.validity - 1];
  if (validity !== 'A' && validity !== 'V') return null;

  const altBaro = readAltitude(line, B.altBaro);
  const altGnss = readAltitude(line, B.altGnss);
  if (Number.isNaN(altBaro) || Number.isNaN(altGnss)) return null;

  let fxa = Number.NaN;
  let siu = Number.NaN;
  let latExtra: ExtraDigits | null = null;
  let lonExtra: ExtraDigits | null = null;
  for (const extension of extensions) {
    const value = readDigits(line, extension.from, extension.to);
    if (Number.isNaN(value)) continue;
    const digits = extension.to - extension.from + 1;
    switch (extension.code) {
      case EXTENSION.accuracy:
        fxa = value;
        break;
      case EXTENSION.satellites:
        siu = value;
        break;
      case EXTENSION.latDigits:
        latExtra = { value, digits };
        break;
      case EXTENSION.lonDigits:
        lonExtra = { value, digits };
        break;
    }
  }

  const lat = coordinate(latDegrees, latMinutes, latExtra, latHemisphere === 'S');
  const lon = coordinate(lonDegrees, lonMinutes, lonExtra, lonHemisphere === 'W');
  if (!(Math.abs(lat) <= MAX_LAT_DEGREES && Math.abs(lon) <= MAX_LON_DEGREES)) return null;

  return {
    secondOfDay: hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds,
    lat,
    lon,
    altBaro,
    altGnss,
    valid: validity === 'A' ? 1 : 0,
    fxa,
    siu,
  };
}

/** I-запись → список расширений; null, если запись битая. */
function readExtensions(line: string): Extension[] | null {
  const count = readDigits(line, I.count.from, I.count.to);
  if (Number.isNaN(count)) return null;

  const extensions: Extension[] = [];
  for (let group = 0; group < count; group++) {
    const at = I.firstGroupAt + group * I.groupLength;
    const from = readDigits(line, at, at + 1);
    const to = readDigits(line, at + 2, at + 3);
    const code = line.slice(at + 3, at + 3 + I.codeLength).toUpperCase();
    if (!(from >= B.firstExtensionByte && to >= from) || code.length !== I.codeLength) return null;
    extensions.push({ code, from, to });
  }
  return extensions;
}

function isWgs84(datum: string): boolean {
  const normalized = datum.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (
    normalized === '' ||
    normalized.startsWith(DATUM_CODE_WGS84) ||
    normalized.includes('WGS84') ||
    normalized.includes('WGS1984')
  );
}

/** Полночь UTC календарной даты; null, если такой даты нет (32.07, 30.02). */
function calendarDay(year: number, month: number, day: number): number | null {
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? ms : null;
}

type DateCheck = { kind: 'ok'; dayStart: number } | { kind: 'invalid' } | { kind: 'out_of_range' };

/** ТЗ §3.3: не раньше 1990 и не в будущем (с допуском на локальную дату в заголовке). */
function checkDate(year: number, month: number, day: number, now: number): DateCheck {
  const dayStart = calendarDay(year, month, day);
  if (dayStart === null) return { kind: 'invalid' };
  if (year < IGC.minYear || dayStart > now + IGC.futureDateToleranceS * TIME.msPerSecond) {
    return { kind: 'out_of_range' };
  }
  return { kind: 'ok', dayStart };
}

/** `HFDTE150726` и `HFDTEDATE:150726,01` → значение после ключа уже без префикса. */
function dateFromHeader(value: string, now: number): DateCheck {
  const match = DDMMYY.exec(value.replace(/^DATE:?/i, ''));
  if (!match) return { kind: 'invalid' };
  const [, dd, mm, yy] = match.map(Number);
  if (dd === undefined || mm === undefined || yy === undefined) return { kind: 'invalid' };
  const year = yy < IGC.twoDigitYearPivot ? CENTURY_21 + yy : CENTURY_20 + yy;
  return checkDate(year, mm, dd, now);
}

function dateFromFileName(fileName: string, now: number): DateCheck {
  const baseName = fileName.split(/[\\/]/).at(-1) ?? '';

  const long = LONG_FILE_NAME.exec(baseName);
  if (long) {
    const [, year, month, day] = long.map(Number);
    if (year !== undefined && month !== undefined && day !== undefined) return checkDate(year, month, day, now);
  }

  const short = SHORT_FILE_NAME.exec(baseName);
  if (short) {
    const [, yearDigit, month, day] = short;
    if (yearDigit !== undefined && month !== undefined && day !== undefined) {
      // Последняя цифра года → ближайший такой год не позже «сейчас».
      const nowYear = new Date(now).getUTCFullYear();
      const year = nowYear - ((nowYear - Number(yearDigit) + DECIMAL_BASE) % DECIMAL_BASE);
      return checkDate(year, parseInt(month, SHORT_NAME_RADIX), parseInt(day, SHORT_NAME_RADIX), now);
    }
  }

  return { kind: 'invalid' };
}

interface ResolvedDate {
  dayStart: number;
  date: string | null;
  source: DateSource | null;
}

function resolveDate(
  header: { value: string; line: number } | null,
  options: IgcParseOptions,
  warnings: WarningLog,
): ResolvedDate {
  const found = (dayStart: number, source: DateSource): ResolvedDate => ({
    dayStart,
    date: new Date(dayStart).toISOString().slice(0, 10),
    source,
  });

  if (header) {
    const check = dateFromHeader(header.value, options.now);
    if (check.kind === 'ok') return found(check.dayStart, 'header');
    warnings.add(check.kind === 'invalid' ? 'date_header_invalid' : 'date_out_of_range', header.line);
  }

  if (options.fileName !== undefined) {
    const check = dateFromFileName(options.fileName, options.now);
    if (check.kind === 'ok') {
      warnings.add('date_from_filename');
      return found(check.dayStart, 'filename');
    }
  }

  // Время остаётся отсчётом от начала эпохи; дату спросят у пользователя.
  warnings.add('date_missing');
  return { dayStart: 0, date: null, source: null };
}

function decodeLatin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += DECODE_CHUNK_BYTES) {
    text += String.fromCharCode(...bytes.subarray(i, i + DECODE_CHUNK_BYTES));
  }
  return text;
}

function stripBom(text: string): string {
  if (text.startsWith(BOM)) return text.slice(BOM.length);
  if (text.startsWith(UTF8_BOM_AS_LATIN1)) return text.slice(UTF8_BOM_AS_LATIN1.length);
  return text;
}

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

/** Точные копии нужной длины: отдельные буферы можно передавать между потоками. */
function truncateColumns(columns: TrackColumns, count: number): TrackColumns {
  return {
    t: columns.t.slice(0, count),
    lat: columns.lat.slice(0, count),
    lon: columns.lon.slice(0, count),
    altBaro: columns.altBaro.slice(0, count),
    altGnss: columns.altGnss.slice(0, count),
    valid: columns.valid.slice(0, count),
    fxa: columns.fxa.slice(0, count),
    siu: columns.siu.slice(0, count),
  };
}

function setOnce(meta: TrackMeta, key: TextMetaKey, value: string): void {
  if (value !== '' && meta[key] === undefined) meta[key] = value;
}

export function parseIgc(input: string | Uint8Array, options: IgcParseOptions): ParseResult {
  const limits: ParseLimits = { maxFileBytes: IGC.maxFileBytes, maxPoints: IGC.maxPoints, ...options.limits };
  const warnings = new WarningLog();

  const size = typeof input === 'string' ? input.length : input.byteLength;
  if (size > limits.maxFileBytes) return { ok: false, code: 'file_too_large', warnings: [] };

  const lines = stripBom(typeof input === 'string' ? input : decodeLatin1(input)).split(LINE_BREAK);
  const columns = allocateColumns(Math.min(lines.length, limits.maxPoints));
  const meta: TrackMeta = { date: null, dateSource: null };

  let dateHeader: { value: string; line: number } | null = null;
  let extensions: Extension[] = [];
  let signature = '';
  let count = 0;
  let dayOffset = 0;
  /** Секунды от полуночи первых суток у последней принятой точки. */
  let lastSecond = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? '').trimEnd();
    const lineNumber = index + 1;
    const recordType = line[0];
    if (recordType === undefined) continue; // пустая строка — не ошибка

    if (recordType === 'B') {
      const fix = readFix(line, extensions);
      if (!fix) {
        warnings.add('malformed_fix', lineNumber);
        continue;
      }

      let second = dayOffset * TIME.secondsPerDay + fix.secondOfDay;
      if (lastSecond - second >= IGC.midnightRolloverMinBackstepS) {
        dayOffset += 1;
        second += TIME.secondsPerDay;
      }
      if (second === lastSecond) {
        warnings.add('duplicate_fix', lineNumber);
        continue;
      }
      if (second < lastSecond) {
        warnings.add('out_of_order_fix', lineNumber);
        continue;
      }
      if (count === limits.maxPoints) return { ok: false, code: 'too_many_points', warnings: warnings.list() };

      columns.t[count] = second;
      columns.lat[count] = fix.lat;
      columns.lon[count] = fix.lon;
      columns.altBaro[count] = fix.altBaro;
      columns.altGnss[count] = fix.altGnss;
      columns.valid[count] = fix.valid;
      columns.fxa[count] = fix.fxa;
      columns.siu[count] = fix.siu;
      count += 1;
      lastSecond = second;
      continue;
    }

    switch (recordType) {
      case 'H': {
        const subtype = line.slice(2, 5).toUpperCase();
        const colon = line.indexOf(':');
        const value = (colon === -1 ? line.slice(5) : line.slice(colon + 1)).trim();
        if (subtype === 'DTE') {
          dateHeader ??= { value, line: lineNumber };
        } else if (subtype === 'DTM') {
          if (!isWgs84(value)) warnings.add('unexpected_datum', lineNumber);
        } else if (subtype in HEADER_FIELDS) {
          setOnce(meta, HEADER_FIELDS[subtype as keyof typeof HEADER_FIELDS], value);
        }
        break;
      }
      case 'I': {
        const parsed = readExtensions(line);
        if (parsed) extensions = parsed;
        else warnings.add('malformed_extensions', lineNumber);
        break;
      }
      case 'A':
        setOnce(meta, 'logger', line.slice(1).trim());
        break;
      case 'G':
        signature += line.slice(1);
        break;
      default:
        if (!IGNORED_RECORDS.has(recordType)) warnings.add('unknown_record', lineNumber);
    }
  }

  if (count === 0) return { ok: false, code: 'no_fixes', warnings: warnings.list() };

  const points = truncateColumns(columns, count);

  // ТЗ §3.3: все 00000 — прибор высоту не пишет; настоящий трек не лежит ровно на нуле.
  const hasBaro = points.altBaro.some((alt) => alt !== 0);
  const hasGnss = points.altGnss.some((alt) => alt !== 0);
  if (!hasBaro) {
    points.altBaro.fill(Number.NaN);
    warnings.add('no_baro_altitude');
  }
  if (!hasGnss) {
    points.altGnss.fill(Number.NaN);
    warnings.add('no_gnss_altitude');
  }

  const date = resolveDate(dateHeader, options, warnings);
  for (let i = 0; i < count; i++) {
    points.t[i] = date.dayStart + (points.t[i] ?? 0) * TIME.msPerSecond;
  }

  meta.date = date.date;
  meta.dateSource = date.source;
  if (signature !== '') meta.signature = signature;

  const track: ParsedTrack = {
    points,
    meta,
    warnings: warnings.list(),
    altitudeSource: hasBaro ? 'baro' : 'gnss',
  };
  return { ok: true, track };
}
