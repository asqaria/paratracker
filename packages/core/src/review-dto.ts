import { z } from 'zod';

import { TIME } from './constants.js';

/**
 * Ручная сверка термиков владельцем полёта (DoD фазы 2: «сверено вручную на
 * 10 треках»). Интервалы — абсолютное время UTC, мс: повторный анализ может
 * сдвинуть границы, а ручная отметка остаётся привязанной ко времени.
 * В файл /fixtures/*.labels.json разметка уходит во времени от начала трека.
 */

export const REVIEW = {
  /** На 5-часовом полёте термиков — десятки; 500 — с запасом, но не безлимит. */
  maxSpans: 500,
  maxNoteLength: 200,
} as const;

export const ReviewSpan = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  note: z.string().trim().max(REVIEW.maxNoteLength).optional(),
}).refine((span) => span.endMs > span.startMs, { message: 'endMs must be after startMs' });
export type ReviewSpan = z.infer<typeof ReviewSpan>;

const Spans = z.array(ReviewSpan).max(REVIEW.maxSpans);

/**
 * confirmed — найденный алгоритмом термик верен; rejected — найденный не
 * термик; missed — термик, который алгоритм пропустил (границы — пилота).
 */
export const ThermalReviewLabels = z.object({
  confirmed: Spans,
  rejected: Spans,
  missed: Spans,
});
export type ThermalReviewLabels = z.infer<typeof ThermalReviewLabels>;

export const EMPTY_REVIEW: ThermalReviewLabels = { confirmed: [], rejected: [], missed: [] };

/** GET /api/v1/flights/{id}/review. */
export const ThermalReviewResponse = z.object({
  labels: ThermalReviewLabels,
  /** null — сверки ещё не было. */
  updatedAt: z.iso.datetime().nullable(),
});
export type ThermalReviewResponse = z.infer<typeof ThermalReviewResponse>;

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** «1:05:09» — время от начала трека, как таймер «Время» в просмотрщике и в *.labels.json. */
export function clockFromStart(ms: number, startMs: number): string {
  const total = Math.max(0, Math.round((ms - startMs) / TIME.msPerSecond));
  const h = Math.floor(total / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR));
  const m = Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const s = total % SECONDS_PER_MINUTE;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Разметка в формате /fixtures/*.labels.json (как real-wind-thermals.labels.json):
 * rejected → notThermals — это имя уже читает тест детекции термиков.
 */
export function toLabelsFile(labels: ThermalReviewLabels, file: string, startMs: number, reviewedAt: string) {
  const span = (s: ReviewSpan) => ({
    start: clockFromStart(s.startMs, startMs),
    end: clockFromStart(s.endMs, startMs),
    ...(s.note ? { note: s.note } : {}),
  });
  return {
    file,
    source: `Сверка владельцем трека на странице сверки (${reviewedAt.slice(0, 10)}): время — от первой точки трека, как таймер «Время» в просмотрщике.`,
    confirmed: labels.confirmed.map(span),
    missed: labels.missed.map(span),
    notThermals: labels.rejected.map(span),
  };
}
