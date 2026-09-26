import type { Locale, LogbookEntry } from '@skyline/core';

import { formatDuration } from '../viewer/format-summary';
import { kilometres, metres, type Translate } from '../viewer/units';

/** Строка логбука → текст для пилота. СИ внутри, км и «ч мин» — только здесь. */

export interface FormattedEntry {
  date: string;
  duration: string;
  distance: string;
  maxAlt: string;
  thermals: string;
}

/** Значения нет: полёт в обработке, упал или у трека нет высоты. */
const MISSING = '—';

/** Без таймзоны (полёт не обработан) — по UTC: часы браузера дали бы третий вариант. */
const FALLBACK_TIMEZONE = 'UTC';

/**
 * Дата — по часам места взлёта (задача 2.14), а не браузера: пилот из
 * Алматы, открывший полёт в Турции, видит тот день, когда он летал.
 */
const formatDate = (iso: string, timezone: string | null, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: timezone ?? FALLBACK_TIMEZONE }).format(new Date(iso));

/** «3 июл. 2026 г., 04:30 GMT+5» — начало полёта по местному времени, с поясом. */
export const formatLocalStart = (iso: string, timezone: string | null, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: timezone ?? FALLBACK_TIMEZONE,
  }).format(new Date(iso));

const orMissing = <T>(value: T | null, format: (v: T) => string): string => (value === null ? MISSING : format(value));

export function formatEntry(entry: LogbookEntry, locale: Locale, t: Translate): FormattedEntry {
  return {
    date: formatDate(entry.startedAt ?? entry.uploadedAt, entry.timezone, locale),
    duration: orMissing(entry.durationS, (s) => formatDuration(s, t)),
    distance: orMissing(entry.distanceTrackM, (m) => kilometres(m, locale, t)),
    maxAlt: orMissing(entry.maxAltM, (m) => metres(m, locale, t)),
    thermals: orMissing(entry.thermalCount, (n) => new Intl.NumberFormat(locale).format(n)),
  };
}
