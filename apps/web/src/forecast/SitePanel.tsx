import type { CompassPoint, ForecastHourDto } from '@skyline/core';
import { useQuery } from '@tanstack/react-query';

import { fill, useLocaleStore, useT } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { compassPoint } from '../viewer/format-analytics';
import { groundSpeed, KMH_PER_MS, metres, verticalSpeed } from '../viewer/units';
import { FORECAST_QUERY_KEY, fetchSiteForecast } from './forecast-api';
import { VERDICT_COLOR } from './forecast-palette';
import { dayWindows, type LocalHour } from './forecast-time';

/**
 * Панель места (задача П.3, ТЗ §6.9): вердикт дня, таблица по часам,
 * подробности выбранного часа — три модели и ветер по высотам. Прогноз не
 * заменяет оценку условий на старте — так и написано под ним.
 */

interface SitePanelProps {
  slug: string;
  /** Светлые часы выбранного дня (местные). */
  dayHours: LocalHour[];
  time: string | null;
  onTime: (time: string) => void;
  attribution: string;
}

/** Стрелка показывает, куда сносит: «откуда» + 180°. */
const DOWNWIND_DEG = 180;
const NO_VALUE = '—';
const MODEL_NAME = { ecmwf: 'ECMWF', gfs: 'GFS', icon: 'ICON' } as const;

const compassKey = (point: CompassPoint): MessageKey => `compass.${point.toLowerCase()}` as MessageKey;

function WindArrow({ dirDeg }: { dirDeg: number }) {
  return (
    <span aria-hidden className="inline-block" style={{ transform: `rotate(${dirDeg + DOWNWIND_DEG}deg)` }}>
      ↑
    </span>
  );
}

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
  const windows = dayWindows(dayHours, (key) => byTime.get(key)?.verdict);
  const updated = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', timeZone: site.timezone }).format(
    new Date(site.fetchedAt),
  );

  // В таблице — только числа, единицы — в подписях строк: иначе столбцы в 13 часов не влезают.
  const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: false });
  const climb = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'always' });
  const num = (value: number | null | undefined, format: Intl.NumberFormat = integer): string =>
    value === null || value === undefined || !Number.isFinite(value) ? NO_VALUE : format.format(value);
  const kmh = (valueMs: number): string => num(valueMs * KMH_PER_MS);
  const rows: { key: string; label: string; cell: (h: ForecastHourDto) => React.ReactNode }[] = [
    {
      key: 'wind',
      label: t('forecast.row.wind'),
      cell: (h) => {
        const m = h.models[0];
        return m ? (
          <span className="flex flex-col items-center">
            <WindArrow dirDeg={m.windDirDeg} />
            <span>{kmh(m.windSpeedMs)}</span>
          </span>
        ) : (
          NO_VALUE
        );
      },
    },
    { key: 'gust', label: t('forecast.row.gust'), cell: (h) => <span className="text-secondary">{kmh(h.models[0]?.gustMs ?? Number.NaN)}</span> },
    { key: 'ceiling', label: t('forecast.row.ceiling'), cell: (h) => num(h.models[0]?.ceilingM) },
    { key: 'thermal', label: t('forecast.row.thermal'), cell: (h) => num(h.models.find((m) => m.thermalMs !== null)?.thermalMs, climb) },
    { key: 'base', label: t('forecast.row.cloudBase'), cell: (h) => num(h.models[0]?.cloudBaseM) },
    { key: 'clouds', label: t('forecast.row.clouds'), cell: (h) => num(h.cloudCoverPct) },
    { key: 'rain', label: t('forecast.row.rain'), cell: (h) => (h.precipitationMm > 0 ? h.precipitationMm.toFixed(1) : NO_VALUE) },
    { key: 'storm', label: t('forecast.row.storm'), cell: (h) => t(`forecast.storm.${h.models[0]?.stormRisk ?? 'low'}`) },
  ];

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

      <div className="overflow-x-auto">
        <table className="numeric w-full border-separate border-spacing-x-0.5 text-center text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-void text-left font-normal text-secondary" />
              {shown.map(({ local, hour }) => (
                <th key={local.time} className="px-0.5">
                  <button
                    type="button"
                    aria-pressed={local.time === time}
                    onClick={() => onTime(local.time)}
                    aria-label={`${String(local.hour).padStart(2, '0')}:00 ${t(`forecast.verdict.${hour.verdict}`)}`}
                    className="flex w-full flex-col items-center gap-1 rounded py-1 aria-pressed:bg-subtle"
                  >
                    <span>{String(local.hour).padStart(2, '0')}</span>
                    <span className="block h-2.5 w-full rounded-sm" style={{ background: VERDICT_COLOR[hour.verdict] }} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="sticky left-0 bg-void pr-2 text-left font-normal text-secondary">
                  {row.label}
                </th>
                {shown.map(({ local, hour }) => (
                  <td key={local.time} className="px-0.5 py-1">
                    {row.cell(hour)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <section data-forecast="hour" className="flex flex-col gap-3 rounded-xl bg-subtle p-3">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: VERDICT_COLOR[selected.verdict] }} />
            <span className="font-semibold">{t(`forecast.verdict.${selected.verdict}`)}</span>
            <span className="text-secondary">· {t(`forecast.confidence.${selected.confidence}`)}</span>
          </div>
          {selected.reasons.length > 0 && (
            <ul className="list-inside list-disc text-secondary">
              {selected.reasons.map((reason) => (
                <li key={reason}>{t(`forecast.reason.${reason}`)}</li>
              ))}
            </ul>
          )}

          <table className="numeric w-full text-left text-xs">
            <thead className="text-secondary">
              <tr>
                <th className="font-normal">{t('forecast.model')}</th>
                <th className="font-normal">{t('forecast.col.wind')}</th>
                <th className="font-normal">{t('forecast.col.ceiling')}</th>
                <th className="font-normal">{t('forecast.col.thermal')}</th>
              </tr>
            </thead>
            <tbody>
              {selected.models.map((m) => (
                <tr key={m.model}>
                  <td className="flex items-center gap-1.5 py-0.5">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: VERDICT_COLOR[m.verdict] }} />
                    {MODEL_NAME[m.model]}
                  </td>
                  <td>
                    {compassPoint(m.windDirDeg, t)} {groundSpeed(m.windSpeedMs, locale, t)}
                  </td>
                  <td>{m.ceilingM === null ? NO_VALUE : metres(m.ceilingM, locale, t)}</td>
                  <td>{m.thermalMs === null ? NO_VALUE : verticalSpeed(m.thermalMs, locale, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected.ceilingRangeM && (
            <p className="text-secondary">
              {fill(t('forecast.ceilingRange'), {
                from: metres(selected.ceilingRangeM[0], locale, t),
                to: metres(selected.ceilingRangeM[1], locale, t),
              })}
            </p>
          )}

          {selected.windProfile.length > 0 && (
            <div>
              <p className="mb-1 text-secondary">{t('forecast.windAloft')}</p>
              <ul className="numeric flex flex-col-reverse gap-0.5 text-xs">
                {selected.windProfile.map((level) => (
                  <li key={level.heightM} className="flex items-center gap-2">
                    <span className="w-16 text-secondary">{metres(level.heightM, locale, t)}</span>
                    <WindArrow dirDeg={level.dirDeg} />
                    <span>{groundSpeed(level.speedMs, locale, t)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <p className="text-xs text-secondary">{t('forecast.disclaimer')}</p>
      <p data-panel="forecast-attribution" className="text-xs text-secondary">
        {fill(t('forecast.attribution'), { source: attribution })}
      </p>
    </div>
  );
}
