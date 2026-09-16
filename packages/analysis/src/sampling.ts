import { CLEAN, TIME, type AnalysisLevel } from '@skyline/core';

/** Медианный шаг между соседними фиксами, с; меньше двух фиксов — NaN. */
export function medianFixIntervalS(t: Float64Array): number {
  if (t.length < 2) return Number.NaN;
  const steps = Float64Array.from(t.subarray(1), (time, i) => (time - (t[i] ?? 0)) / TIME.msPerSecond).sort();
  const mid = steps.length >> 1;
  return steps.length % 2 === 1 ? (steps[mid] ?? Number.NaN) : ((steps[mid - 1] ?? 0) + (steps[mid] ?? 0)) / 2;
}

/**
 * ТЗ §5.2: медианный шаг больше порога → 'basic' — термики и ветер не считаются,
 * интерполяция срежет виражи хордами. Неизвестный шаг — тоже 'basic'.
 */
export function analysisLevelFor(medianIntervalS: number): AnalysisLevel {
  return medianIntervalS <= CLEAN.maxMedianFixIntervalForFullAnalysisS ? 'full' : 'basic';
}
