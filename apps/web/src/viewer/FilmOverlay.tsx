import { flightRange } from '@skyline/analysis';
import type { FlightDetailsResponse } from '@skyline/core';
import { useMemo } from 'react';

import { fill, useLocaleStore, useT } from '../i18n/locale';
import type { DecodedTrack } from './decode-track';
import type { FilmCard, SceneFacts } from './film-titles';
import { formatDuration } from './format-summary';
import { indexAt, MS_PER_SECOND } from './playback';
import { kilometres, metres, verticalSpeed } from './units';

/**
 * Титры фильма (задача 4.3, ТЗ §7.6): заставка с местом и датой, подпись
 * сцены с её цифрами, итоги на посадке; всё время — мини-график высоты с
 * бегунком и живые цифры (время, высота, варио). Поверх сцены, клики
 * проходят насквозь — кроме кнопки выхода, она в scene.tsx.
 */

interface FilmOverlayProps {
  card: FilmCard;
  facts: SceneFacts | null;
  details: FlightDetailsResponse | null;
  track: DecodedTrack;
  timeMs: number;
}

/** Точек мини-графика: больше — не видно, меньше — ломаная. */
const CHART_POINTS = 300;
const CHART_W = 1000;
const CHART_H = 100;
const RATIO_DECIMALS = 1;

export function FilmOverlay({ card, facts, details, track, timeMs }: FilmOverlayProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const timezone = details?.timezone ?? 'UTC';
  const range = useMemo(() => flightRange(track.t, track.gSpeed), [track]);

  // Мини-график высоты полёта (от взлёта до посадки) — одна ломаная на весь фильм.
  const chart = useMemo(() => {
    const from = range.takeoff;
    const to = Math.max(from + 1, range.landing);
    let min = Infinity;
    let max = -Infinity;
    for (let i = from; i <= to; i++) {
      const a = track.alt[i] ?? Number.NaN;
      if (Number.isFinite(a)) {
        min = Math.min(min, a);
        max = Math.max(max, a);
      }
    }
    const span = max - min || 1;
    const step = Math.max(1, Math.floor((to - from) / CHART_POINTS));
    const points: string[] = [];
    for (let i = from; i <= to; i += step) {
      const a = track.alt[i] ?? Number.NaN;
      if (!Number.isFinite(a)) continue;
      points.push(`${(((i - from) / (to - from)) * CHART_W).toFixed(1)},${(CHART_H - ((a - min) / span) * CHART_H).toFixed(1)}`);
    }
    return { points: points.join(' '), from, to };
  }, [track, range]);

  const index = indexAt(track.t, timeMs);
  const progress = Math.min(1, Math.max(0, (index - chart.from) / (chart.to - chart.from)));
  const altM = track.alt[index] ?? Number.NaN;
  const varioMs = track.vSpeed[index] ?? Number.NaN;
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(timeMs));
  const takeoffMs = track.t[range.takeoff] ?? timeMs;
  const airtimeS = Math.max(0, ((track.t[range.landing] ?? takeoffMs) - takeoffMs) / MS_PER_SECOND);
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }).format(
    new Date(details?.startedAt ?? takeoffMs),
  );

  const factText = (f: SceneFacts): string | null => {
    if (f.gainM !== undefined && f.climbMs !== undefined) {
      return fill(t('film.fact.thermal'), { gain: metres(f.gainM, locale, t), climb: verticalSpeed(f.climbMs, locale, t) });
    }
    if (f.distanceM !== undefined) {
      const ratio =
        f.glideRatio === null || f.glideRatio === undefined
          ? null
          : new Intl.NumberFormat(locale, { maximumFractionDigits: RATIO_DECIMALS }).format(f.glideRatio);
      return ratio === null
        ? kilometres(f.distanceM, locale, t)
        : fill(t('film.fact.glide'), { distance: kilometres(f.distanceM, locale, t), ratio });
    }
    if (f.altM !== undefined) return metres(f.altM, locale, t);
    return null;
  };

  const stats: { label: string; value: string }[] = [
    { label: t('film.closing.airtime'), value: formatDuration(airtimeS, t) },
    { label: t('film.closing.distance'), value: kilometres(track.summary.distanceTrackM, locale, t) },
    { label: t('film.closing.maxAlt'), value: metres(track.summary.maxAltM, locale, t) },
    details?.xc
      ? { label: t('film.closing.xc'), value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(details.xc.score) }
      : { label: t('film.closing.gain'), value: metres(track.summary.maxGainM, locale, t) },
  ];

  const fade = (on: boolean): string => `transition-opacity duration-700 ${on ? 'opacity-100' : 'opacity-0'}`;

  return (
    <div data-panel="film-overlay" className="pointer-events-none absolute inset-0">
      {/* Заставка: место и дата. */}
      <div className={`absolute inset-0 grid place-items-center ${fade(card === 'opening')}`}>
        <div data-film="opening" className="rounded-2xl glass px-8 py-6 text-center">
          <p className="text-3xl font-semibold compact:text-2xl">{details?.takeoffSite?.name ?? t('film.flight')}</p>
          <p className="mt-1 text-lg text-secondary">{date}</p>
        </div>
      </div>

      {/* Подпись сцены. */}
      {facts && (
        <div
          data-film="caption"
          className={`absolute left-4 top-4 rounded-xl glass px-4 py-2 compact:left-2 compact:top-2 ${fade(card === 'caption')}`}
        >
          <p className="text-lg font-semibold">{t(`film.scene.${facts.kind}`)}</p>
          {factText(facts) !== null && <p className="numeric text-secondary">{factText(facts)}</p>}
        </div>
      )}

      {/* Итоги полёта. */}
      <div className={`absolute inset-0 grid place-items-center ${fade(card === 'closing')}`}>
        <div data-film="closing" className="rounded-2xl glass px-8 py-6 compact:px-5">
          <p className="mb-3 text-center text-lg font-semibold">{details?.takeoffSite?.name ?? t('film.flight')} · {date}</p>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="text-xs text-secondary">{s.label}</dt>
                <dd className="numeric text-2xl">{s.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-center text-sm font-semibold text-accent">{t('app.name')}</p>
        </div>
      </div>

      {/* Живые цифры и мини-график высоты — над атрибуцией. */}
      <div className="absolute bottom-10 left-4 right-4 flex items-end gap-4 compact:left-2 compact:right-2">
        <svg
          data-film="chart"
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          className="h-12 flex-1 overflow-visible"
          aria-hidden
        >
          <polyline points={chart.points} fill="none" className="stroke-primary" strokeWidth={2} vectorEffect="non-scaling-stroke" opacity={0.8} />
          <line
            x1={progress * CHART_W}
            x2={progress * CHART_W}
            y1={0}
            y2={CHART_H}
            className="stroke-accent"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div data-film="hud" className="numeric shrink-0 rounded-xl glass px-3 py-1.5 text-right text-sm">
          <p>{clock}</p>
          <p>{metres(altM, locale, t)}</p>
          <p className="text-secondary">{verticalSpeed(varioMs, locale, t)}</p>
        </div>
      </div>
    </div>
  );
}
