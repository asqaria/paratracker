import { useState } from 'react';

import { fill, useLocaleStore, useT } from '../i18n/locale';
import type { GliderDto } from '@skyline/core';

import { GliderLine } from '../gliders/GliderLine';
import { formatLocalStart } from '../logbook/format-logbook';
import { XcCard } from './XcCard';
import { reviewHash } from '../routing';
import { SiteLine } from '../sites/SiteLine';
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
  /** Колонны термиков на сцене (ТЗ §7.2); без обработчика переключателя нет. */
  columnsShown?: boolean;
  onColumnsShown?: (shown: boolean) => void;
  /** Внутри шторки на телефоне: без своей рамки и кнопки сворачивания — сворачивает шторка. */
  embedded?: boolean;
  /** Добавить место старта своего полёта (задача 2.13); без обработчика формы нет. */
  onCreateSite?: (name: string) => Promise<void>;
  /** Крылья владельца и смена крыла полёта (задача 2.13б); без них — только подпись. */
  gliders?: GliderDto[] | undefined;
  onSetGlider?: (gliderId: string | null) => Promise<void>;
  /** XC-маршрут на сцене (задача 3.3); без обработчика переключателя нет. */
  xcRouteShown?: boolean;
  onXcRouteShown?: (shown: boolean) => void;
  /** Показать весь XC-маршрут камерой сверху. */
  onShowXcRoute?: () => void;
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

export function AnalyticsPanel({
  state,
  timeline,
  timeMs,
  onSelect,
  defaultOpen = false,
  defaultTab = 'thermals',
  columnsShown = true,
  onColumnsShown,
  embedded = false,
  onCreateSite,
  gliders,
  onSetGlider,
  xcRouteShown = true,
  onXcRouteShown,
  onShowXcRoute,
}: AnalyticsPanelProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const [collapsedOpen, setOpen] = useState(defaultOpen);
  const open = embedded || collapsedOpen;
  const [tab, setTab] = useState<AnalyticsTab>(defaultTab);

  return (
    <section
      aria-label={t('viewer.analytics')}
      data-panel="analytics"
      className={embedded ? 'text-sm' : 'w-80 rounded-xl glass text-sm compact:max-h-[45dvh] compact:w-72 compact:overflow-y-auto'}
    >
      {!embedded && (
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
      )}
      {open && (
        <div className={embedded ? 'pt-1' : 'border-t border-subtle px-3 pb-3 pt-2'}>
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
            <div className="mb-2">
              {state.analytics.details.startedAt !== null && (
                <p data-panel="flight-start" className="text-sm">
                  <span className="text-secondary">{t('flight.start')}: </span>
                  <span className="numeric text-primary">
                    {formatLocalStart(state.analytics.details.startedAt, state.analytics.details.timezone, locale)}
                  </span>
                </p>
              )}
              <SiteLine
                site={state.analytics.details.takeoffSite}
                canEdit={state.analytics.details.canEdit && onCreateSite !== undefined}
                onCreate={onCreateSite ?? (() => Promise.resolve())}
              />
              <GliderLine
                glider={state.analytics.details.glider}
                gliderRaw={state.analytics.details.gliderRaw}
                gliders={state.analytics.details.canEdit && onSetGlider ? gliders : undefined}
                onSelect={onSetGlider ?? (() => Promise.resolve())}
              />
            </div>
          )}
          {state.status === 'ready' && state.analytics.details.xc && (
            <XcCard
              xc={state.analytics.details.xc}
              routeShown={xcRouteShown}
              {...(onXcRouteShown ? { onRouteShown: onXcRouteShown } : {})}
              {...(onShowXcRoute ? { onShowRoute: onShowXcRoute } : {})}
            />
          )}
          {state.status === 'ready' && (
            <Content analytics={state.analytics} timeline={timeline} timeMs={timeMs} tab={tab} onTab={setTab} onSelect={onSelect} embedded={embedded} />
          )}
          {state.status === 'ready' && state.analytics.details.canEdit && state.analytics.thermals.length > 0 && (
            <a href={reviewHash(state.analytics.details.flightId)} className="mt-2 block text-xs text-accent">
              {t('review.open')}
            </a>
          )}
          {state.status === 'ready' && state.analytics.thermals.length > 0 && onColumnsShown && (
            <button
              type="button"
              aria-pressed={columnsShown}
              onClick={() => onColumnsShown(!columnsShown)}
              className="mt-2 flex items-center gap-2 text-xs text-secondary aria-pressed:text-primary compact:min-h-11"
            >
              <span aria-hidden="true" className="grid size-3.5 place-items-center rounded-sm border border-subtle">
                {columnsShown ? '✓' : ''}
              </span>
              {t('viewer.analytics.columns')}
            </button>
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
  /** Внутри шторки — список без своей прокрутки: прокручивает шторка. */
  embedded: boolean;
}

function Content({ analytics, timeline, timeMs, tab, onTab, onSelect, embedded }: ContentProps) {
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
          <ul className={embedded ? '' : 'max-h-[40vh] overflow-y-auto compact:max-h-none'}>
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
