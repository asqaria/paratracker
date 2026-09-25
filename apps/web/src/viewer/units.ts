import type { Locale } from '@skyline/core';

import { fill } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';

/**
 * Единицы на границе UI (CLAUDE.md, «Единицы»): внутри системы СИ, здесь —
 * то, что видит пилот. Метрическая система ТЗ §8.4: м, км/ч, м/с.
 * Разделитель дробной части — по локали, через Intl.
 */

export type Translate = (key: MessageKey) => string;

const NO_VALUE = '—';
const METRES_PER_KILOMETRE = 1000;
/** 1 м/с = 3.6 км/ч. */
const KMH_PER_MS = 3.6;
/** Дистанция — до сотни метров: точнее GNSS-трек после медианного фильтра не скажет. */
const KILOMETRE_DECIMALS = 1;
/** Варио — до десятой, как на приборах. */
const VARIO_DECIMALS = 1;

const integer = (locale: Locale): Intl.NumberFormat =>
  // Высоты четырёхзначные и без разрядов — цифры в телеметрии не должны «прыгать».
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: false });

const fixed = (locale: Locale, digits: number, signed = false): Intl.NumberFormat =>
  new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
    ...(signed ? { signDisplay: 'always' as const } : {}),
  });

const unit = (value: number, key: MessageKey, t: Translate, format: Intl.NumberFormat): string =>
  Number.isFinite(value) ? fill(t(key), { value: format.format(value) }) : NO_VALUE;

/** Высота, набор — целые метры. */
export const metres = (valueM: number, locale: Locale, t: Translate): string =>
  unit(valueM, 'unit.metres', t, integer(locale));

/** Дистанция: на входе метры, на экране километры с одним знаком. */
export const kilometres = (valueM: number, locale: Locale, t: Translate): string =>
  unit(valueM / METRES_PER_KILOMETRE, 'unit.kilometres', t, fixed(locale, KILOMETRE_DECIMALS));

/** Вертикальная скорость со знаком: «+1,8 м/с», ноль — «+0,0». */
export const verticalSpeed = (valueMs: number, locale: Locale, t: Translate): string =>
  unit(valueMs, 'unit.metresPerSecond', t, fixed(locale, VARIO_DECIMALS, true));

/** Путевая скорость: на входе м/с, на экране целые км/ч. */
export const groundSpeed = (valueMs: number, locale: Locale, t: Translate): string =>
  unit(valueMs * KMH_PER_MS, 'unit.kilometresPerHour', t, integer(locale));
