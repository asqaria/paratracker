import type { CompassPoint } from '@skyline/core';
import { useQuery } from '@tanstack/react-query';

import { fill, useLocaleStore, useT } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { compassPoint } from '../viewer/format-analytics';
import { groundSpeed, metres, verticalSpeed } from '../viewer/units';
import { FORECAST_QUERY_KEY, fetchSiteForecast } from './forecast-api';
import { INSTABILITY_COLOR, VERDICT_COLOR } from './forecast-palette';
import { dayWindows, type LocalHour } from './forecast-time';
import { Meteogram } from './Meteogram';
import { INSTABILITY_CLASSES } from './meteogram-scale';

/**
 * Панель места (задачи П.3, П.6, ТЗ §6.9): вердикт дня, диаграмма
 * «время × высота» вместо таблиц и короткая карточка выбранного часа.
 * Прогноз не заменяет оценку условий на старте — так и написано под ним.
 */

interface SitePanelProps {
  slug: string;
  /** Светлые часы выбранного дня (местные). */
  dayHours: LocalHour[];
  time: string | null;
  onTime: (time: string) => void;
  attribution: string;
}

const NO_VALUE = '—';
const MODEL_NAME = { ecmwf: 'ECMWF', gfs: 'GFS', icon: 'ICON' } as const;
/** Стрелка показывает, куда сносит: «откуда» + 180°. */
const DOWNWIND_DEG = 180;
const RAIN_DECIMALS = 1;

const compassKey = (point: CompassPoint): MessageKey => `compass.${point.toLowerCase()}` as MessageKey;

export function SitePanel({ slug, dayHours, time, onTime, attribution }: SitePanelProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const query = useQuery({ queryKey: [...FORECAST_QUERY_KEY, slug], queryFn: () => fetchSiteForecast(slug) });

  if (query.isError) return <p role="alert" className="text-danger">{t('forecast.error')}</p>;
  if (!query.data) return <p className="text-secondary">{t('forecast.loading')}</p>;
  const { site, hours } = query.data;
  const byTime = new Map(hours.map((h) => [h.time, h]));
  const shown = dayHours.flatMap((local) => {
    const hour = byTime.get(local.time);
    return hour ? [{ local, hour }] : [];
  });
  const selected = time === null ? undefined : byTime.get(time);
  const primary = selected?.models[0];
  const windows = dayWindows(dayHours, (key) => byTime.get(key)?.verdict);
  const updated = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', timeZone: site.timezone }).format(
    new Date(site.fetchedAt),
  );
  const climbMs = selected?.models.find((m) => m.thermalMs !== null)?.thermalMs ?? null;
  const range = selected?.ceilingRangeM ?? null;
  const facts: { label: string; value: string }[] =
    selected && primary
      ? [
          {
            label: t('forecast.col.wind'),
            value: `${compassPoint(primary.windDirDeg, t)} ${groundSpeed(primary.windSpeedMs, locale, t)} · ${fill(t('forecast.gustsUpTo'), {
              gust: groundSpeed(primary.gustMs, locale, t),
            })}`,
          },
          {
            label: t('forecast.col.ceiling'),
            value: range ? `${metres(primary.ceilingM ?? range[0], locale, t)} (${metres(range[0], locale, t)}–${metres(range[1], locale, t)})` : NO_VALUE,
          },
          { label: t('forecast.col.thermal'), value: climbMs === null ? NO_VALUE : verticalSpeed(climbMs, locale, t) },
          { label: t('forecast.col.cloudBase'), value: primary.cloudBaseM === null ? t('forecast.noCumulus') : metres(primary.cloudBaseM, locale, t) },
          { label: t('forecast.col.clouds'), value: `${Math.round(selected.cloudCoverPct)}%` },
          {
            label: t('forecast.col.rain'),
            value: selected.precipitationMm > 0 ? selected.precipitationMm.toFixed(RAIN_DECIMALS) : NO_VALUE,
          },
          { label: t('forecast.col.storm'), value: t(`forecast.storm.${primary.stormRisk}`) },
        ]
      : [];

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <h2 className="text-base font-semibold">{site.name}</h2>
        <p className="text-secondary">
          {fill(t('forecast.sector'), { sector: site.windSectors.map((p) => t(compassKey(p))).join(', ') || NO_VALUE })} ·{' '}
          {fill(t('forecast.maxWind'), { wind: groundSpeed(site.maxWindMs, locale, t) })}
        </p>
        <p className="text-secondary">{fill(t('forecast.updated'), { time: updated })}</p>
      </div>

      <p data-forecast="day-summary" className="font-semibold">
        {windows.fly === null
          ? t('forecast.day.nofly')
          : fill(t('forecast.day.fly'), { from: String(windows.fly[0]), to: String(windows.fly[1]) }) +
            (windows.xc === null ? '' : ` · ${fill(t('forecast.day.xc'), { from: String(windows.xc[0]), to: String(windows.xc[1]) })}`)}
      </p>

      <div className="flex flex-col gap-2">
        <Meteogram hours={shown} elevationM={site.elevationM ?? shown[0]?.hour.surface.heightM ?? 0} time={time} onTime={onTime} />
        <ul data-forecast="legend" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
          {INSTABILITY_CLASSES.map((c) => (
            <li key={c.id} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: INSTABILITY_COLOR[c.id] }} />
              {t(`forecast.instability.${c.id}`)}
            </li>
          ))}
          <li className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-primary" />
            {t('forecast.legend.ceiling')}
          </li>
          <li className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-3 rounded-sm bg-primary/25" />
            {t('forecast.legend.range')}
          </li>
          <li className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-3 rounded-sm bg-void/60 ring-1 ring-subtle" />
            {t('forecast.legend.aboveCeiling')}
          </li>
          <li>☁ {t('forecast.legend.cloudBase')}</li>
          <li>
            ↗{' '}
            {shown[0]?.hour.windModel
              ? fill(t('forecast.legend.windBy'), { model: MODEL_NAME[shown[0].hour.windModel] })
              : t('forecast.legend.wind')}
          </li>
        </ul>
      </div>

      {selected && (
        <section data-forecast="hour" className="flex flex-col gap-3 rounded-xl bg-subtle p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: VERDICT_COLOR[selected.verdict] }} />
            <span className="font-semibold">{t(`forecast.verdict.${selected.verdict}`)}</span>
            {selected.reasons.length > 0 && (
              <span className="text-secondary">· {selected.reasons.map((r) => t(`forecast.reason.${r}`)).join(', ')}</span>
            )}
          </div>

          <dl className="numeric grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {facts.map((fact) => (
              <div key={fact.label} className="contents">
                <dt className="text-secondary">{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-secondary">{t(`forecast.confidence.${selected.confidence}`)}:</span>
            {selected.models.map((m) => (
              <span key={m.model} className="numeric flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: VERDICT_COLOR[m.verdict] }} />
                {MODEL_NAME[m.model]}
                <span aria-hidden className="inline-block" style={{ transform: `rotate(${m.windDirDeg + DOWNWIND_DEG}deg)` }}>
                  ↑
                </span>
                {groundSpeed(m.windSpeedMs, locale, t)}
                {m.ceilingM !== null && ` · ${metres(m.ceilingM, locale, t)}`}
              </span>
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-secondary">{t('forecast.disclaimer')}</p>
      <p data-panel="forecast-attribution" className="text-xs text-secondary">
        {fill(t('forecast.attribution'), { source: attribution })}
      </p>
    </div>
  );
}
