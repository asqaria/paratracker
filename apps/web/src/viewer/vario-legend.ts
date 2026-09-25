import type { Locale } from '@skyline/core';

import { VARIO_RANGE_MS, VARIO_STOPS, varioCss } from './vario-palette';

/**
 * Легенда раскраски трека (ТЗ §7.3: «обязательно легенда с числовой шкалой»).
 * Шкала линейна по скорости: опорные точки палитры неравномерны (−5, −2, −0.5,
 * 0, +0.5, +2, +5), и равномерная раскладка цветов поставила бы жёлтый +0.5
 * туда, где по подписям почти +2 — пилот прочёл бы по легенде неверное число.
 */

/** Подписи шкалы, м/с: края диапазона, ноль и ±2 — граница «слабо / хорошо». */
export const LEGEND_TICKS_MS: readonly number[] = [-VARIO_RANGE_MS, -2, 0, 2, VARIO_RANGE_MS];

const FULL_PCT = 100;

/** Положение скорости на полосе, % слева; за диапазоном — край, как у цвета трека. */
export function legendPosition(vSpeed: number): number {
  const clamped = Math.min(VARIO_RANGE_MS, Math.max(-VARIO_RANGE_MS, vSpeed));
  // Сначала умножение: (5.5 / 10) * 100 даёт 55.00000000000001, (5.5 * 100) / 10 — ровно 55.
  return ((clamped + VARIO_RANGE_MS) * FULL_PCT) / (2 * VARIO_RANGE_MS);
}

/**
 * CSS-градиент из тех же опорных точек, что красят трек. Цвета — rgb(),
 * поэтому браузер смешивает их в sRGB, как varioRgb смешивает вершины.
 */
export function legendGradient(): string {
  const stops = VARIO_STOPS.map((stop) => `${varioCss(stop.vSpeed)} ${legendPosition(stop.vSpeed)}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

export interface LegendTick {
  vSpeed: number;
  positionPct: number;
  label: string;
}

export function legendTicks(locale: Locale): LegendTick[] {
  const format = new Intl.NumberFormat(locale, { signDisplay: 'exceptZero', maximumFractionDigits: 1 });
  return LEGEND_TICKS_MS.map((vSpeed) => ({ vSpeed, positionPct: legendPosition(vSpeed), label: format.format(vSpeed) }));
}
