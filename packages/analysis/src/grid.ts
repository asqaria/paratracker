import { TIME } from '@skyline/core';

/**
 * Обход сегментов трека: fn(start, end) для каждого участка без разрыва, границы включительно.
 * isBreak получает шаг между соседними точками в мс.
 */
export function forEachSegment(
  t: Float64Array,
  isBreak: (stepMs: number) => boolean,
  fn: (start: number, end: number) => void,
): void {
  let start = 0;
  for (let i = 1; i <= t.length; i++) {
    if (i === t.length || isBreak((t[i] ?? 0) - (t[i - 1] ?? 0))) {
      fn(start, i - 1);
      start = i;
    }
  }
}

/** Сегменты исходных фиксов: разрыв — пропуск дольше maxGapS. */
export function breakAfterGap(maxGapS: number): (stepMs: number) => boolean {
  const maxGapMs = maxGapS * TIME.msPerSecond;
  return (stepMs) => stepMs > maxGapMs;
}

/** Сегменты равномерной сетки: разрыв — любой шаг, отличный от intervalS. */
export function breakOffGrid(intervalS: number): (stepMs: number) => boolean {
  const intervalMs = intervalS * TIME.msPerSecond;
  return (stepMs) => stepMs !== intervalMs;
}
