import type { ReviewSpan, ThermalReviewLabels } from '@skyline/core';

/**
 * Разметка сверки термиков (DoD фазы 2) — чистые функции над ThermalReviewLabels.
 * Найденный термик узнаётся по точным границам: повторный анализ может их
 * сдвинуть, тогда отметка просто перестанет совпадать и её поставят заново.
 */

export type Verdict = 'confirmed' | 'rejected';

export interface Span {
  startMs: number;
  endMs: number;
}

const same = (a: Span, b: Span): boolean => a.startMs === b.startMs && a.endMs === b.endMs;
const without = (spans: readonly ReviewSpan[], span: Span): ReviewSpan[] => spans.filter((s) => !same(s, span));

export function verdictOf(labels: ThermalReviewLabels, span: Span): Verdict | null {
  if (labels.confirmed.some((s) => same(s, span))) return 'confirmed';
  if (labels.rejected.some((s) => same(s, span))) return 'rejected';
  return null;
}

/** Поставить отметку; та же отметка повторно — снять (кнопка-переключатель). */
export function toggleVerdict(labels: ThermalReviewLabels, span: Span, verdict: Verdict): ThermalReviewLabels {
  const current = verdictOf(labels, span);
  const cleared = { ...labels, confirmed: without(labels.confirmed, span), rejected: without(labels.rejected, span) };
  if (current === verdict) return cleared;
  const entry = { startMs: span.startMs, endMs: span.endMs };
  return verdict === 'confirmed'
    ? { ...cleared, confirmed: [...cleared.confirmed, entry] }
    : { ...cleared, rejected: [...cleared.rejected, entry] };
}

/** Пропущенный термик: границы в любом порядке, пустой интервал не добавляется. */
export function addMissed(labels: ThermalReviewLabels, aMs: number, bMs: number): ThermalReviewLabels {
  const startMs = Math.round(Math.min(aMs, bMs));
  const endMs = Math.round(Math.max(aMs, bMs));
  if (endMs <= startMs) return labels;
  const missed = [...labels.missed, { startMs, endMs }].sort((x, y) => x.startMs - y.startMs);
  return { ...labels, missed };
}

export function removeMissed(labels: ThermalReviewLabels, span: Span): ThermalReviewLabels {
  return { ...labels, missed: without(labels.missed, span) };
}

/** Сколько найденных термиков уже отмечено — для «отмечено 12 из 28». */
export function reviewProgress(labels: ThermalReviewLabels, thermals: readonly Span[]): { done: number; total: number } {
  return { done: thermals.filter((span) => verdictOf(labels, span) !== null).length, total: thermals.length };
}
