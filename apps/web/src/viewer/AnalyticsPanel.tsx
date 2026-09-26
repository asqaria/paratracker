import { useState } from 'react';

import { fill, useLocaleStore, useT } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import type { AnalyticsState, FlightAnalytics } from './flight-analytics';
import { glideRatioText, segmentDuration, windText } from './format-analytics';
import { elapsedClock, type TrackTimeline } from './playback';
import { groundSpeed, kilometres, metres, verticalSpeed } from './units';
import { varioCss } from './vario-palette';

/**
 * Панель «Аналитика» (ТЗ §8.3, задача 2.6): цифры полёта, списки термиков и
 * глайдов; клик по строке — переход к сегменту. Свёрнута по умолчанию —
 * прогрессивное раскрытие (§8.1). Cesium здесь нет: перелёт камеры — в сцене.
 */

export type AnalyticsTab = 'thermals' | 'glides';

/** Сегмент полёта, выбранный в списке: время начала и конца, UTC мс. */
export interface SelectedSegment {
  kind: 'thermal' | 'glide';
  startMs: number;
  endMs: number;
}

export interface AnalyticsPanelProps {
  state: AnalyticsState;
  timeline: TrackTimeline;
  timeMs: number;
  onSelect: (segment: SelectedSegment) => void;
  defaultOpen?: boolean;
  defaultTab?: AnalyticsTab;
}

const TABS: ReadonlyArray<{ id: AnalyticsTab; label: MessageKey }> = [
  { id: 'thermals', label: 'viewer.analytics.thermals' },
  { id: 'glides', label: 'viewer.analytics.glides' },
];

interface Row {
  key: number;
  startMs: number;
  endMs: number;
  cells: string[];
  /** Средний набор для цветной точки палитры варио; null — строка глайда. */
  climbMs: number | null;
}

export function AnalyticsPanel({ state, timeline, timeMs, onSelect, defaultOpen = false, defaultTab = 'thermals' }: AnalyticsPanelProps) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<AnalyticsTab>(defaultTab);

  return (
    <section aria-label={t('viewer.analytics')} data-panel="analytics" className="w-80 rounded-xl glass text-sm compact:max-h-[45dvh] compact:w-72 compact:overflow-y-auto">
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? t('viewer.analytics.hide') : t('viewer.analytics.show')}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2 text-primary compact:min-h-11"
      >
        <span>{t('viewer.analytics')}</span>
        <span aria-hidden="true" className="text-secondary">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="border-t border-subtle px-3 pb-3 pt-2">
          {state.status === 'loading' && (
            <p role="status" className="text-secondary">
              {t('viewer.analytics.loading')}
            </p>
          )}
          {state.status === 'error' && (
            <p role="alert" className="text-danger">
              {t('viewer.analytics.error')}
            </p>
          )}
          {state.status === 'ready' && (
            <Content analytics={state.analytics} timeline={timeline} timeMs={timeMs} tab={tab} onTab={setTab} onSelect={onSelect} />
          )}
        </div>
      )}
    </section>
  );
}

interface ContentProps {
  analytics: FlightAnalytics;
  timeline: TrackTimeline;
  timeMs: number;
  tab: AnalyticsTab;
  onTab: (tab: AnalyticsTab) => void;
  onSelect: (segment: SelectedSegment) => void;
}

function Content({ analytics, timeline, timeMs, tab, onTab, onSelect }: ContentProps) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const { details } = analytics;

  if (details.analysisLevel === 'basic') {
    return <p className="text-secondary">{t('viewer.analytics.basic')}</p>;
  }
  // Число термиков записывается при каждом анализе, даже нулевое; null — анализ
  // не делался: полёт обработан раньше, чем анализ появился в конвейере.
  if (details.thermalCount === null) {
    return <p className="text-secondary">{t('viewer.analytics.notAnalysed')}</p>;
  }

  // Термиков нет — лучшего нет: NaN превращается в прочерк при форматировании.
  const bestClimb = analytics.thermals.length > 0 ? Math.max(...analytics.thermals.map((th) => th.avgClimbMs)) : Number.NaN;
  const stats: ReadonlyArray<{ label: MessageKey; value: string }> = [
    { label: 'viewer.analytics.thermalCount', value: String(details.thermalCount) },
    { label: 'viewer.analytics.bestClimb', value: verticalSpeed(bestClimb, locale, t) },
    { label: 'viewer.analytics.avgClimb', value: verticalSpeed(details.avgClimbMs ?? Number.NaN, locale, t) },
    { label: 'viewer.analytics.avgGlideRatio', value: glideRatioText(details.avgGlideRatio, locale) },
    { label: 'viewer.analytics.wind', value: windText(details.wind, locale, t) },
  ];

  const ms = (value: string): number => Date.parse(value);
  const rows: Row[] =
    tab === 'thermals'
      ? analytics.thermals.map((th) => ({
          key: th.seq,
          startMs: ms(th.startedAt),
          endMs: ms(th.endedAt),
          climbMs: th.avgClimbMs,
          cells: [
            elapsedClock(timeline, ms(th.startedAt)),
            metres(th.gainM, locale, t),
            verticalSpeed(th.avgClimbMs, locale, t),
            segmentDuration(th.durationS),
          ],
        }))
      : analytics.glides.map((g) => ({
          key: g.seq,
          startMs: ms(g.startedAt),
          endMs: ms(g.endedAt),
          climbMs: null,
          cells: [
            elapsedClock(timeline, ms(g.startedAt)),
            kilometres(g.distanceM, locale, t),
            glideRatioText(g.glideRatio, locale),
            groundSpeed(g.avgSpeedMs, locale, t),
          ],
        }));
  const columns: readonly MessageKey[] =
    tab === 'thermals'
      ? ['viewer.analytics.col.time', 'viewer.analytics.col.gain', 'viewer.analytics.col.climb', 'viewer.analytics.col.duration']
      : ['viewer.analytics.col.time', 'viewer.analytics.col.distance', 'viewer.analytics.col.ratio', 'viewer.analytics.col.speed'];
  const empty = tab === 'thermals' ? 'viewer.analytics.noThermals' : 'viewer.analytics.noGlides';

  return (
    <>
      {/* Цифры — моноширинные с табличными цифрами (ТЗ §8.4). */}
      <dl data-analytics="stats" className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col">
            <dt className="text-xs text-secondary">{t(stat.label)}</dt>
            <dd className="numeric">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div role="group" aria-label={t('viewer.analytics')} className="mt-3 flex gap-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === tab}
            onClick={() => onTab(item.id)}
            className="rounded px-2 py-1 text-secondary aria-pressed:bg-subtle aria-pressed:text-primary compact:min-h-11"
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 text-secondary">{t(empty)}</p>
      ) : (
        <div className="mt-2">
          <div aria-hidden="true" className="grid grid-cols-[4.5rem_1fr_1fr_3.5rem] gap-2 px-2 text-2xs text-secondary">
            {columns.map((column) => (
              <span key={column}>{t(column)}</span>
            ))}
          </div>
          <ul className="max-h-[40vh] overflow-y-auto compact:max-h-none">
            {rows.map((row) => {
              const current = timeMs >= row.startMs && timeMs <= row.endMs;
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    aria-current={current ? 'true' : undefined}
                    aria-label={fill(t('viewer.analytics.goTo'), { time: row.cells[0] ?? '' })}
                    onClick={() => onSelect({ kind: tab === 'thermals' ? 'thermal' : 'glide', startMs: row.startMs, endMs: row.endMs })}
                    className="numeric grid w-full grid-cols-[4.5rem_1fr_1fr_3.5rem] items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-left text-xs hover:bg-subtle aria-[current=true]:bg-subtle aria-[current=true]:text-primary compact:min-h-11"
                  >
                    {row.cells.map((cell, index) => (
                      <span key={index} className="flex items-center gap-1.5">
                        {index === 2 && row.climbMs !== null && (
                          <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: varioCss(row.climbMs) }} />
                        )}
                        {cell}
                      </span>
                    ))}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
