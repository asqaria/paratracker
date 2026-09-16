import { describe, expect, it } from 'vitest';

import { checkCalendarDate, checkFixDate, isoDate, parseIsoTime } from './dates.js';

const NOW = Date.UTC(2027, 0, 1);

describe('parseIsoTime', () => {
  it.each([
    ['2026-07-15T09:00:00Z', Date.UTC(2026, 6, 15, 9)],
    ['2026-07-15T14:00:00+05:00', Date.UTC(2026, 6, 15, 9)],
    ['2026-07-15T14:00:00+0500', Date.UTC(2026, 6, 15, 9)],
    ['2026-07-15T04:30:00-04:30', Date.UTC(2026, 6, 15, 9)],
    ['2026-07-15T09:00:00.250Z', Date.UTC(2026, 6, 15, 9, 0, 0, 250)],
    ['2026-07-15T09:00:00.123456Z', Date.UTC(2026, 6, 15, 9, 0, 0, 123)],
    ['2026-07-15t09:00:00z', Date.UTC(2026, 6, 15, 9)],
    // GPX требует UTC; без зоны — UTC, а не локальное время машины, где идёт разбор.
    ['2026-07-15T09:00:00', Date.UTC(2026, 6, 15, 9)],
    ['  2026-07-15T09:00:00Z\n', Date.UTC(2026, 6, 15, 9)],
  ])('%j', (text, ms) => {
    expect(parseIsoTime(text)).toBe(ms);
  });

  it.each([
    '',
    'garbage',
    '15.07.2026 09:00',
    '2026-07-15',
    '2026-02-30T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-07-15T24:00:00Z',
    '2026-07-15T09:60:00Z',
    '2026-07-15T09:00:00+25:00',
  ])('не время: %j', (text) => {
    expect(parseIsoTime(text)).toBeNaN();
  });
});

describe('checkCalendarDate', () => {
  it('существующая дата в диапазоне — полночь UTC', () => {
    expect(checkCalendarDate(2026, 7, 15, NOW)).toEqual({ kind: 'ok', dayStart: Date.UTC(2026, 6, 15) });
  });

  it('несуществующая дата — invalid', () => {
    expect(checkCalendarDate(2026, 2, 30, NOW)).toEqual({ kind: 'invalid' });
  });

  it('раньше 1990 или в будущем дальше суток — out_of_range', () => {
    expect(checkCalendarDate(1989, 12, 31, NOW)).toEqual({ kind: 'out_of_range' });
    expect(checkCalendarDate(2027, 1, 3, NOW)).toEqual({ kind: 'out_of_range' });
    expect(checkCalendarDate(2027, 1, 2, NOW).kind).toBe('ok');
  });
});

describe('checkFixDate', () => {
  it('дата первой точки — полночь UTC её суток', () => {
    expect(checkFixDate(Date.UTC(2026, 6, 15, 23, 59), NOW)).toEqual({ kind: 'ok', dayStart: Date.UTC(2026, 6, 15) });
  });

  it('время сбитого прибора — out_of_range', () => {
    expect(checkFixDate(Date.UTC(1985, 0, 1), NOW).kind).toBe('out_of_range');
    expect(checkFixDate(Date.UTC(2030, 0, 1), NOW).kind).toBe('out_of_range');
  });
});

describe('isoDate', () => {
  it('YYYY-MM-DD в UTC', () => {
    expect(isoDate(Date.UTC(2026, 6, 15, 23, 59, 59))).toBe('2026-07-15');
  });
});
