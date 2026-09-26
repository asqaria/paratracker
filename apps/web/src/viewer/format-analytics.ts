import type { Locale, WindDto } from '@skyline/core';

import { fill } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { groundSpeed, type Translate } from './units';

/**
 * Аналитика полёта → строки для пилота (задача 2.6). Внутри СИ, км/ч и румбы —
 * только здесь, на границе UI (CLAUDE.md, «Единицы»).
 */

const NO_VALUE = '—';
const FULL_TURN_DEG = 360;
const COMPASS: readonly MessageKey[] = [
  'compass.n',
  'compass.ne',
  'compass.e',
  'compass.se',
  'compass.s',
  'compass.sw',
  'compass.w',
  'compass.nw',
];
/** Качество — до десятой: точнее его не знает ни прибор, ни пилот. */
const RATIO_DECIMALS = 1;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** Румб из восьми по направлению в градусах (метеорологическое — откуда дует). */
export function compassPoint(dirDeg: number, t: Translate): string {
  const sector = FULL_TURN_DEG / COMPASS.length;
  const index = Math.round((((dirDeg % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG) / sector) % COMPASS.length;
  return t(COMPASS[index] ?? 'compass.n');
}

/** «СВ 13 км/ч»; нет ветра — прочерк. */
export function windText(wind: WindDto | null, locale: Locale, t: Translate): string {
  if (!wind) return NO_VALUE;
  return fill(t('viewer.analytics.windValue'), { dir: compassPoint(wind.dirDeg, t), speed: groundSpeed(wind.speedMs, locale, t) });
}

/** Качество с десятыми; null — 'dynamic', высота почти не терялась (ТЗ §6.4). */
export function glideRatioText(ratio: number | null, locale: Locale): string {
  if (ratio === null || !Number.isFinite(ratio)) return NO_VALUE;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: RATIO_DECIMALS, maximumFractionDigits: RATIO_DECIMALS }).format(ratio);
}

/** Длительность сегмента: «11:10», дольше часа — «1:02:05». */
export function segmentDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor(total / SECONDS_PER_MINUTE) % SECONDS_PER_MINUTE;
  const secs = String(total % SECONDS_PER_MINUTE).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}
