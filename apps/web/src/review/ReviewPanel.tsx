import { EMPTY_REVIEW, type ThermalDto, type ThermalReviewLabels } from '@skyline/core';
import { useState } from 'react';

import { fill, useLocaleStore, useT } from '../i18n/locale';
import { flightHash } from '../routing';
import type { SelectedSegment } from '../viewer/AnalyticsPanel';
import type { AnalyticsState } from '../viewer/flight-analytics';
import { segmentDuration } from '../viewer/format-analytics';
import { elapsedClock, type TrackTimeline } from '../viewer/playback';
import { metres, verticalSpeed } from '../viewer/units';
import { varioCss } from '../viewer/vario-palette';
import { addMissed, removeMissed, reviewProgress, toggleVerdict, verdictOf, type Verdict } from './review-state';
import { reviewUrl, useThermalReview, type SaveState } from './use-review';

export interface ReviewPanelViewProps {
  flightId: string;
  thermals: ThermalDto[];
  labels: ThermalReviewLabels | undefined;
  saveState: SaveState;
  failed: boolean;
  timeline: TrackTimeline;
  timeMs: number;
  /** Правка разметки функцией от её текущего состояния. */
  onChange: (change: (labels: ThermalReviewLabels) => ThermalReviewLabels) => void;
  onSelect: (segment: SelectedSegment) => void;
  embedded?: boolean;
}

const VERDICTS: ReadonlyArray<{ verdict: Verdict; mark: string; label: 'review.confirm' | 'review.reject' }> = [
  { verdict: 'confirmed', mark: '✓', label: 'review.confirm' },
  { verdict: 'rejected', mark: '✗', label: 'review.reject' },
];

/**
 * Сверка термиков владельцем (DoD фазы 2): у каждого найденного — «верно» или
 * «не термик»; пропущенный — «начало здесь» и «конец здесь» по текущему
 * времени проигрывания. Каждая отметка сохраняется сразу. Из разметки —
 * /fixtures/*.labels.json и регрессионный тест детекции.
 */
export function ReviewPanelView(props: ReviewPanelViewProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const [missedStart, setMissedStart] = useState<number | null>(null);
  const labels = props.labels ?? EMPTY_REVIEW;
  const ms = (iso: string) => Date.parse(iso);
  const spans = props.thermals.map((th) => ({ startMs: ms(th.startedAt), endMs: ms(th.endedAt) }));
  const progress = reviewProgress(labels, spans);

  return (
    <section
      data-panel="review"
      aria-label={t('review.title')}
      className={props.embedded ? 'text-sm' : 'w-96 rounded-xl glass p-3 text-sm compact:max-h-[45dvh] compact:w-72 compact:overflow-y-auto'}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t('review.title')}</h2>
        <a href={flightHash(props.flightId)} className="text-xs text-secondary hover:text-primary">
          {t('review.exit')}
        </a>
      </header>
      <p className="text-xs text-secondary">{t('review.hint')}</p>
      <p className="mt-1 flex items-center justify-between text-xs">
        <span className="numeric">{fill(t('review.progress'), { done: String(progress.done), total: String(progress.total) })}</span>
        <span role="status" className={props.saveState === 'error' ? 'text-danger' : 'text-secondary'}>
          {t(`review.save.${props.saveState}`)}
        </span>
      </p>
      {props.failed && (
        <p role="alert" className="mt-1 text-danger">
          {t('review.loadError')}
        </p>
      )}

      {/* Список ниже, чем в «Аналитике»: под ним — пропущенные и выгрузка, и всё должно влезть над таймлайном. */}
      <ul className={props.embedded ? 'mt-2' : 'mt-2 max-h-[30vh] overflow-y-auto compact:max-h-none'}>
        {props.thermals.map((th, i) => {
          const span = spans[i] ?? { startMs: 0, endMs: 0 };
          const current = verdictOf(labels, span);
          const playing = props.timeMs >= span.startMs && props.timeMs <= span.endMs;
          return (
            <li key={th.seq} className="flex items-center gap-1">
              <button
                type="button"
                aria-current={playing ? 'true' : undefined}
                aria-label={fill(t('viewer.analytics.goTo'), { time: elapsedClock(props.timeline, span.startMs) })}
                onClick={() => props.onSelect({ kind: 'thermal', ...span })}
                className="numeric grid flex-1 grid-cols-[4rem_3.5rem_1fr_2.5rem] items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-left text-xs hover:bg-subtle aria-[current=true]:bg-subtle compact:min-h-11"
              >
                <span>{elapsedClock(props.timeline, span.startMs)}</span>
                <span>{metres(th.gainM, locale, t)}</span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: varioCss(th.avgClimbMs) }} />
                  {verticalSpeed(th.avgClimbMs, locale, t)}
                </span>
                <span>{segmentDuration(th.durationS)}</span>
              </button>
              {VERDICTS.map((v) => (
                <button
                  key={v.verdict}
                  type="button"
                  aria-label={t(v.label)}
                  aria-pressed={current === v.verdict}
                  onClick={() => props.onChange((current) => toggleVerdict(current, span, v.verdict))}
                  className={`size-7 rounded text-secondary aria-pressed:text-void compact:size-11 ${
                    v.verdict === 'confirmed' ? 'aria-pressed:bg-accent' : 'aria-pressed:bg-danger'
                  }`}
                >
                  {v.mark}
                </button>
              ))}
            </li>
          );
        })}
      </ul>

      <div className="mt-3 border-t border-subtle pt-2">
        <h3 className="text-xs text-secondary">{t('review.missed')}</h3>
        <div className="mt-1 flex items-center gap-2">
          {missedStart === null ? (
            <button type="button" onClick={() => setMissedStart(props.timeMs)} className="rounded bg-subtle px-2 py-1 compact:min-h-11">
              {t('review.missedStart')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  const end = props.timeMs;
                  props.onChange((current) => addMissed(current, missedStart, end));
                  setMissedStart(null);
                }}
                className="rounded bg-accent px-2 py-1 text-void compact:min-h-11"
              >
                {fill(t('review.missedEnd'), { start: elapsedClock(props.timeline, missedStart) })}
              </button>
              <button type="button" onClick={() => setMissedStart(null)} className="text-secondary compact:min-h-11">
                {t('site.cancel')}
              </button>
            </>
          )}
        </div>
        <ul className="mt-1 text-xs">
          {labels.missed.map((span) => (
            <li key={span.startMs} className="numeric flex items-center justify-between">
              <span>{`${elapsedClock(props.timeline, span.startMs)} — ${elapsedClock(props.timeline, span.endMs)}`}</span>
              <button
                type="button"
                aria-label={t('gliders.delete')}
                onClick={() => props.onChange((current) => removeMissed(current, span))}
                className="px-2 text-secondary hover:text-danger compact:min-h-11"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>

      <a href={`${reviewUrl(props.flightId)}/labels.json`} className="mt-3 inline-block text-xs text-accent">
        {t('review.download')}
      </a>
    </section>
  );
}

interface ReviewPanelProps {
  flightId: string;
  analytics: AnalyticsState;
  timeline: TrackTimeline;
  timeMs: number;
  onSelect: (segment: SelectedSegment) => void;
  embedded?: boolean;
}

export function ReviewPanel({ flightId, analytics, ...rest }: ReviewPanelProps) {
  const { review, failed, saveState, update } = useThermalReview(flightId);
  return (
    <ReviewPanelView
      flightId={flightId}
      thermals={analytics.status === 'ready' ? analytics.analytics.thermals : []}
      labels={review?.labels}
      saveState={saveState}
      failed={failed}
      onChange={update}
      {...rest}
    />
  );
}
