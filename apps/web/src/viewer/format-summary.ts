import type { FlightSummary, Locale } from '@skyline/core';

import { fill } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';

/**
 * Сводка полёта → строки для пилота (задача 1.13). Внутри системы СИ,
 * километры и «ч мин» появляются только здесь, на границе UI (CLAUDE.md).
 */

export type Translate = (key: MessageKey) => string;

export interface FormattedSummary {
  duration: string;
  maxAlt: string;
  distance: string;
  maxGain: string;
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const METRES_PER_KILOMETRE = 1000;
/** Дистанция — до сотни метров: точнее GNSS-трек после медианного фильтра не скажет. */
const KILOMETRE_DECIMALS = 1;
const NO_VALUE = '—';

function formatDuration(durationS: number, t: Translate): string {
  const totalMinutes = Math.round(durationS / SECONDS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (hours === 0) return fill(t('unit.minutes'), { minutes: String(minutes) });
  return fill(t('unit.hoursMinutes'), { hours: String(hours), minutes: String(minutes).padStart(2, '0') });
}

export function formatSummary(summary: FlightSummary, locale: Locale, t: Translate): FormattedSummary {
  // Высоты четырёхзначные и без разрядов — как в телеметрии таймлайна.
  const metres = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: false });
  const kilometres = new Intl.NumberFormat(locale, {
    minimumFractionDigits: KILOMETRE_DECIMALS,
    maximumFractionDigits: KILOMETRE_DECIMALS,
    useGrouping: false,
  });
  const inMetres = (value: number): string =>
    Number.isFinite(value) ? fill(t('unit.metres'), { value: metres.format(value) }) : NO_VALUE;

  return {
    duration: formatDuration(summary.durationS, t),
    maxAlt: inMetres(summary.maxAltM),
    distance: fill(t('unit.kilometres'), { value: kilometres.format(summary.distanceTrackM / METRES_PER_KILOMETRE) }),
    maxGain: inMetres(summary.maxGainM),
  };
}
