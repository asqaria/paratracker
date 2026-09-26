import type { SeasonStatsResponse } from '@skyline/core';

import { fill, useLocaleStore, useT } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { formatDuration } from '../viewer/format-summary';
import { kilometres, metres } from '../viewer/units';

interface SeasonStatsViewProps {
  stats: SeasonStatsResponse;
  onYear: (year: number) => void;
}

/** Высота графика по месяцам в единицах viewBox: ширина — 12 столбцов по 10. */
const CHART = { barWidth: 10, gap: 2, height: 40 } as const;
const MISSING = '—';

/**
 * Статистика сезона (задача 2.12, ТЗ §8.2 /logbook): итоги года, рекорды,
 * время в воздухе по месяцам и топ мест. График — свой SVG: 12 столбцов,
 * библиотека графиков ради них не окупается (CLAUDE.md: не Recharts).
 */
export function SeasonStatsView({ stats, onYear }: SeasonStatsViewProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const { totals } = stats;
  const orMissing = (value: number | null, format: (v: number) => string) => (value === null ? MISSING : format(value));

  const tiles: { label: MessageKey; value: string }[] = [
    { label: 'stats.flights', value: new Intl.NumberFormat(locale).format(totals.flights) },
    { label: 'stats.airtime', value: formatDuration(totals.airtimeS, t) },
    { label: 'stats.distance', value: kilometres(totals.distanceM, locale, t) },
    { label: 'stats.gain', value: metres(totals.gainM, locale, t) },
    { label: 'stats.maxAlt', value: orMissing(totals.maxAltM, (m) => metres(m, locale, t)) },
    { label: 'stats.longest', value: orMissing(totals.longestAirtimeS, (s) => formatDuration(s, t)) },
    { label: 'stats.farthest', value: orMissing(totals.longestDistanceM, (m) => kilometres(m, locale, t)) },
  ];

  const maxMonth = Math.max(1, ...stats.byMonth.map((m) => m.airtimeS));
  // Подпись под столбцом — номер месяца: узкие русские «И», «И» (июнь, июль) не различить.
  // Полное название — в подсказке столбца.
  const monthName = (month: number) =>
    new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month - 1, 1)));

  return (
    <section data-panel="season-stats" className="rounded-xl glass p-4 compact:p-2">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t('stats.title')}</h2>
        {stats.years.length > 0 && (
          <select
            aria-label={t('stats.year')}
            value={stats.year ?? ''}
            onChange={(event) => onYear(Number(event.target.value))}
            className="rounded bg-subtle px-2 py-1 text-sm text-primary"
          >
            {stats.years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        )}
      </header>

      <dl className="grid grid-cols-4 gap-x-4 gap-y-2 text-sm compact:grid-cols-2">
        {tiles.map((tile) => (
          <div key={tile.label}>
            <dt className="text-xs text-secondary">{t(tile.label)}</dt>
            <dd className="numeric text-primary">{tile.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 grid grid-cols-[2fr_1fr] gap-4 compact:grid-cols-1">
        <figure>
          <figcaption className="mb-1 text-xs text-secondary">{t('stats.byMonth')}</figcaption>
          <svg
            role="img"
            aria-label={t('stats.byMonth')}
            viewBox={`0 0 ${12 * (CHART.barWidth + CHART.gap)} ${CHART.height}`}
            preserveAspectRatio="none"
            className="h-20 w-full"
          >
            {stats.byMonth.map((m, i) => {
              const h = (m.airtimeS / maxMonth) * CHART.height;
              return (
                <rect
                  key={m.month}
                  x={i * (CHART.barWidth + CHART.gap)}
                  y={CHART.height - h}
                  width={CHART.barWidth}
                  height={h}
                  rx={1}
                  className="fill-accent"
                >
                  <title>{`${monthName(m.month)}: ${formatDuration(m.airtimeS, t)}`}</title>
                </rect>
              );
            })}
          </svg>
          <div className="grid grid-cols-12 text-center text-2xs text-secondary">
            {stats.byMonth.map((m) => (
              <span key={m.month} className="numeric">
                {m.month}
              </span>
            ))}
          </div>
        </figure>

        <div>
          <h3 className="mb-1 text-xs text-secondary">{t('stats.topSites')}</h3>
          {stats.topSites.length === 0 && <p className="text-sm text-secondary">{MISSING}</p>}
          <ol className="text-sm">
            {stats.topSites.map((site) => (
              <li key={site.id} className="flex justify-between gap-2">
                <span className="truncate">{site.name}</span>
                <span className="numeric text-secondary">
                  {fill(t('stats.siteFlights'), { count: String(site.flights) })}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
