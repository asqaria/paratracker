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
