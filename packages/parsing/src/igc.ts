import { IGC, TIME, type DateSource, type ParsedTrack, type ParseResult, type TrackMeta } from '@skyline/core';

import { applyGnssDatum, igcAltitudeDatum } from './altitude-datum.js';
import { checkCalendarDate, isoDate, type DateCheck } from './dates.js';
import { decodeLatin1, inputSize, stripBom } from './text.js';
import {
  isValidCoordinate,
  resolveLimits,
  summarizeAltitudes,
  TrackBuilder,
  WarningLog,
  type ParseOptions,
} from './track-builder.js';

/**
 * Парсер IGC по ТЗ §3.3. Чистая функция: на входе строка или байты, на выходе
 * ParsedTrack. Ни сети, ни файловой системы, ни текущего времени — «сейчас»
 * передаётся параметром. На кривой строке не бросает: пишет предупреждение и идёт дальше.
 */

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

const LINE_BREAK = /\r\n|\r|\n/;
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
  if (!isValidCoordinate(lat, lon)) return null;

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

/** `HFDTE150726` и `HFDTEDATE:150726,01` → значение после ключа уже без префикса. */
function dateFromHeader(value: string, now: number): DateCheck {
  const match = DDMMYY.exec(value.replace(/^DATE:?/i, ''));
  if (!match) return { kind: 'invalid' };
  const [, dd, mm, yy] = match.map(Number);
  if (dd === undefined || mm === undefined || yy === undefined) return { kind: 'invalid' };
  const year = yy < IGC.twoDigitYearPivot ? CENTURY_21 + yy : CENTURY_20 + yy;
  return checkCalendarDate(year, mm, dd, now);
}

function dateFromFileName(fileName: string, now: number): DateCheck {
  const baseName = fileName.split(/[\\/]/).at(-1) ?? '';

  const long = LONG_FILE_NAME.exec(baseName);
  if (long) {
    const [, year, month, day] = long.map(Number);
    if (year !== undefined && month !== undefined && day !== undefined) {
      return checkCalendarDate(year, month, day, now);
    }
  }

  const short = SHORT_FILE_NAME.exec(baseName);
  if (short) {
    const [, yearDigit, month, day] = short;
    if (yearDigit !== undefined && month !== undefined && day !== undefined) {
      // Последняя цифра года → ближайший такой год не позже «сейчас».
      const nowYear = new Date(now).getUTCFullYear();
      const year = nowYear - ((nowYear - Number(yearDigit) + DECIMAL_BASE) % DECIMAL_BASE);
      return checkCalendarDate(year, parseInt(month, SHORT_NAME_RADIX), parseInt(day, SHORT_NAME_RADIX), now);
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
  options: ParseOptions,
  warnings: WarningLog,
): ResolvedDate {
  if (header) {
    const check = dateFromHeader(header.value, options.now);
    if (check.kind === 'ok') return { dayStart: check.dayStart, date: isoDate(check.dayStart), source: 'header' };
    warnings.add(check.kind === 'invalid' ? 'date_header_invalid' : 'date_out_of_range', header.line);
  }

  if (options.fileName !== undefined) {
    const check = dateFromFileName(options.fileName, options.now);
    if (check.kind === 'ok') {
      warnings.add('date_from_filename');
      return { dayStart: check.dayStart, date: isoDate(check.dayStart), source: 'filename' };
    }
  }

  // Время остаётся отсчётом от начала эпохи; дату спросят у пользователя.
  warnings.add('date_missing');
  return { dayStart: 0, date: null, source: null };
}

function setOnce(meta: TrackMeta, key: TextMetaKey, value: string): void {
  if (value !== '' && meta[key] === undefined) meta[key] = value;
}

export function parseIgc(input: string | Uint8Array, options: ParseOptions): ParseResult {
  const limits = resolveLimits(options);
  if (inputSize(input) > limits.maxFileBytes) return { ok: false, code: 'file_too_large', warnings: [] };

  const lines = stripBom(typeof input === 'string' ? input : decodeLatin1(input)).split(LINE_BREAK);
  const warnings = new WarningLog();
  // Время в builder — секунды от полуночи первых суток; в мс переводится, когда известна дата.
  const builder = new TrackBuilder({ maxPoints: limits.maxPoints, warnings, initialCapacity: lines.length });
  const meta: TrackMeta = { date: null, dateSource: null };

  let dateHeader: { value: string; line: number } | null = null;
  let altitudeDatumHeader: { value: string; line: number } | null = null;
  let extensions: Extension[] = [];
  let signature = '';
  let dayOffset = 0;

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
      if (builder.lastTime - second >= IGC.midnightRolloverMinBackstepS) {
        dayOffset += 1;
        second += TIME.secondsPerDay;
      }
      if (builder.push({ ...fix, t: second }, lineNumber) === 'limit') {
        return { ok: false, code: 'too_many_points', warnings: warnings.list() };
      }
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
        } else if (subtype === 'ALG') {
          // HFALG:GEO и HFALGALTGPS:GEO — значение после двоеточия. Первый заголовок побеждает, как у HFDTE.
          altitudeDatumHeader ??= { value, line: lineNumber };
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

  if (builder.count === 0) return { ok: false, code: 'no_fixes', warnings: warnings.list() };

  const points = builder.finish();
  // ТЗ §3.3: все 00000 — прибор высоту не пишет; настоящий трек не лежит ровно на нуле.
  if (points.altBaro.every((alt) => alt === 0)) points.altBaro.fill(Number.NaN);
  if (points.altGnss.every((alt) => alt === 0)) points.altGnss.fill(Number.NaN);
  // После проверки нулей: иначе «высоты нет» превратилось бы в высоту геоида.
  const altitudeDatum = igcAltitudeDatum(altitudeDatumHeader?.value ?? null);
  if (!altitudeDatum.recognized) warnings.add('unknown_altitude_datum', altitudeDatumHeader?.line);
  meta.gnssAltitudeDatum = applyGnssDatum(points, altitudeDatum.datum);
  const altitudeSource = summarizeAltitudes(points, warnings);

  const date = resolveDate(dateHeader, options, warnings);
  for (let i = 0; i < points.t.length; i++) {
    points.t[i] = date.dayStart + (points.t[i] ?? 0) * TIME.msPerSecond;
  }

  meta.date = date.date;
  meta.dateSource = date.source;
  if (signature !== '') meta.signature = signature;

  const track: ParsedTrack = { points, meta, warnings: warnings.list(), altitudeSource };
  return { ok: true, track };
}
