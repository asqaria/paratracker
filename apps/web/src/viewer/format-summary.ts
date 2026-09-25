import type { FlightSummary, Locale } from '@skyline/core';

import { fill } from '../i18n/locale';
import { kilometres, metres, type Translate } from './units';

/**
 * Сводка полёта → строки для пилота (задача 1.13). Внутри системы СИ,
 * километры и «ч мин» появляются только здесь, на границе UI (CLAUDE.md).
 */

export type { Translate } from './units';

export interface FormattedSummary {
  duration: string;
  maxAlt: string;
  distance: string;
  maxGain: string;
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

function formatDuration(durationS: number, t: Translate): string {
  const totalMinutes = Math.round(durationS / SECONDS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (hours === 0) return fill(t('unit.minutes'), { minutes: String(minutes) });
  return fill(t('unit.hoursMinutes'), { hours: String(hours), minutes: String(minutes).padStart(2, '0') });
}

export function formatSummary(summary: FlightSummary, locale: Locale, t: Translate): FormattedSummary {
  return {
    duration: formatDuration(summary.durationS, t),
    maxAlt: metres(summary.maxAltM, locale, t),
    distance: kilometres(summary.distanceTrackM, locale, t),
    maxGain: metres(summary.maxGainM, locale, t),
  };
}
