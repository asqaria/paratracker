import { PARSER, TIME } from '@skyline/core';

export type DateCheck = { kind: 'ok'; dayStart: number } | { kind: 'invalid' } | { kind: 'out_of_range' };

const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const HOURS_PER_DAY = 24;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * TIME.msPerSecond;
const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
const MS_PER_DAY = TIME.secondsPerDay * TIME.msPerSecond;
/** Часовые пояса Земли — от UTC−12 до UTC+14. */
const MAX_UTC_OFFSET_HOURS = 14;
/** Доли секунды: миллисекунды — первые три цифры. */
const MS_DIGITS = 3;

/** ISO 8601 с временем: `2026-07-15T09:00:00[.sss][Z|±hh:mm|±hhmm]`. */
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/i;

/** Полночь UTC календарной даты; null, если такой даты нет (32.07, 30.02). */
export function calendarDay(year: number, month: number, day: number): number | null {
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? ms : null;
}

/** ТЗ §3.3: не раньше 1990 и не в будущем (с допуском). */
function inRange(year: number, instant: number, now: number): boolean {
  return year >= PARSER.minYear && instant <= now + PARSER.futureDateToleranceS * TIME.msPerSecond;
}

export function checkCalendarDate(year: number, month: number, day: number, now: number): DateCheck {
  const dayStart = calendarDay(year, month, day);
  if (dayStart === null) return { kind: 'invalid' };
  return inRange(year, dayStart, now) ? { kind: 'ok', dayStart } : { kind: 'out_of_range' };
}

/** Дата по времени первой точки (GPX, KML): полночь UTC её суток. */
export function checkFixDate(t: number, now: number): DateCheck {
  if (!Number.isFinite(t)) return { kind: 'invalid' };
  const dayStart = Math.floor(t / MS_PER_DAY) * MS_PER_DAY;
  return inRange(new Date(t).getUTCFullYear(), t, now) ? { kind: 'ok', dayStart } : { kind: 'out_of_range' };
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * UNIX мс из ISO 8601; NaN, если строка не время. Без Date.parse: он принимает
 * что угодно, а время без зоны читает в поясе машины. GPX требует UTC — без зоны это UTC.
 */
export function parseIsoTime(text: string): number {
  const match = ISO_DATE_TIME.exec(text.trim());
  if (!match) return Number.NaN;
  const [, year, month, day, hours, minutes, seconds, fraction, zone] = match;

  const dayStart = calendarDay(Number(year), Number(month), Number(day));
  const h = Number(hours);
  const m = Number(minutes);
  const s = Number(seconds);
  if (dayStart === null || !(h < HOURS_PER_DAY && m < MINUTES_PER_HOUR && s < SECONDS_PER_MINUTE)) return Number.NaN;

  const ms = fraction === undefined ? 0 : Number(fraction.slice(0, MS_DIGITS).padEnd(MS_DIGITS, '0'));

  let offset = 0;
  if (zone !== undefined && zone.toUpperCase() !== 'Z') {
    const digits = zone.slice(1).replace(':', '');
    const offsetHours = Number(digits.slice(0, 2));
    const offsetMinutes = Number(digits.slice(2));
    if (offsetHours > MAX_UTC_OFFSET_HOURS || offsetMinutes >= MINUTES_PER_HOUR) return Number.NaN;
    offset = (zone.startsWith('-') ? -1 : 1) * (offsetHours * MS_PER_HOUR + offsetMinutes * MS_PER_MINUTE);
  }

  return dayStart + h * MS_PER_HOUR + m * MS_PER_MINUTE + s * TIME.msPerSecond + ms - offset;
}
