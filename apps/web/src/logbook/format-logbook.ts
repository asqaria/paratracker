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

/**
 * Дата по UTC. Локальная дата места старта — с задачей 2.14 (таймзона по
 * месту); до неё часы браузера дали бы другой день, чем у пилота на горе.
 */
const formatDate = (iso: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));

const orMissing = <T>(value: T | null, format: (v: T) => string): string => (value === null ? MISSING : format(value));

export function formatEntry(entry: LogbookEntry, locale: Locale, t: Translate): FormattedEntry {
  return {
    date: formatDate(entry.startedAt ?? entry.uploadedAt, locale),
    duration: orMissing(entry.durationS, (s) => formatDuration(s, t)),
    distance: orMissing(entry.distanceTrackM, (m) => kilometres(m, locale, t)),
    maxAlt: orMissing(entry.maxAltM, (m) => metres(m, locale, t)),
    thermals: orMissing(entry.thermalCount, (n) => new Intl.NumberFormat(locale).format(n)),
  };
}
