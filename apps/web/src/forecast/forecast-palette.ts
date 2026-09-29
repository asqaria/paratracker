import type { ForecastVerdict } from '@skyline/core';

/**
 * Цвета вердиктов прогноза (задача П.3) — данные, как палитра вариометра:
 * зелёный — лётно, синий — XC-день (как в плане, согласованном с владельцем),
 * янтарный — на грани, серый — нелётно. Не спорят с бирюзой ветра (3.14).
 */
export const VERDICT_COLOR: Record<ForecastVerdict, string> = {
  xc: '#3b82f6',
  flyable: '#22c55e',
  marginal: '#f59e0b',
  nofly: '#6b7280',
};

/**
 * Неустойчивость на диаграмме «время × высота» (задача П.6) — привычная пилотам
 * шкала AeroXC: синий — инверсия и устойчиво, зелёный — слабо, жёлтый —
 * умеренно, оранжевый — хорошие термики, красный — сильные.
 */
export const INSTABILITY_COLOR = {
  inversion: '#3b5bdb',
  stable: '#4dabf7',
  weak: '#69db7c',
  moderate: '#ffd43b',
  good: '#ff922b',
  strong: '#f03e3e',
} as const;

/** Опорные точки плавной шкалы: темп остывания, °C/100 м → цвет класса. */
const INSTABILITY_STOPS: readonly (readonly [number, string])[] = [
  [0, INSTABILITY_COLOR.inversion],
  [0.4, INSTABILITY_COLOR.stable],
  [0.55, INSTABILITY_COLOR.weak],
  [0.7, INSTABILITY_COLOR.moderate],
  [0.85, INSTABILITY_COLOR.good],
  [1, INSTABILITY_COLOR.strong],
];

const HEX_RADIX = 16;
const channels = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), HEX_RADIX),
  Number.parseInt(hex.slice(3, 5), HEX_RADIX),
  Number.parseInt(hex.slice(5, 7), HEX_RADIX),
];

/**
 * Цвет неустойчивости без ступенек: линейно между опорными цветами шкалы —
 * по нему диаграмма перетекает, как у AeroXC, а не прыгает по классам.
 */
export function instabilityColorAt(lapse: number, alpha: number): string {
  const stops = INSTABILITY_STOPS;
  const first = stops[0];
  const last = stops.at(-1);
  if (!first || !last) return INSTABILITY_COLOR.moderate;
  let lower = first;
  let upper = last;
  for (let k = 1; k < stops.length; k++) {
    const stop = stops[k];
    const prev = stops[k - 1];
    if (stop && prev && lapse <= stop[0]) {
      lower = prev;
      upper = stop;
      break;
    }
  }
  const span = upper[0] - lower[0];
  const u = span > 0 ? Math.min(1, Math.max(0, (lapse - lower[0]) / span)) : 0;
  const a = channels(lower[1]);
  const b = channels(upper[1]);
  const mix = a.map((c, i) => Math.round(c + ((b[i] ?? c) - c) * u));
  return `rgb(${mix.join(' ')} / ${alpha})`;
}
