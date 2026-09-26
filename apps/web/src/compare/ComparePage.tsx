import type { SameDayFlight } from '@skyline/core';
import { useQueries, useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useMemo, useState, type FormEvent } from 'react';

import type { Locale } from '@skyline/core';
import { fill, useLocaleStore, useT } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { formatDuration } from '../viewer/format-summary';
import { kilometres } from '../viewer/units';
import { LOGBOOK_HASH } from '../routing';
import { compareColor } from '../viewer/compare-palette';
import type { CompareFlight } from '../viewer/compare-scene';
import { loadTrack } from '../viewer/use-track';
import { fetchCompareDetails, fetchSameDay, resolveRef, trackUrl, type ResolvedFlight } from './compare-api';
import { COMPARE_MAX_FLIGHTS, compareHash, refFromLink, refKey, type FlightRef } from './compare-refs';

/**
 * Страница сравнения треков (задача 3.12): состав — в адресе (compare-refs),
 * полёты грузятся параллельно, сцена — ленивым чанком с Cesium (ТЗ §7.7).
 */
const CompareScene = lazy(() => import('../viewer/compare-scene'));

/** Разрешённые ссылки и загруженные треки не меняются, пока открыта страница. */
const FOREVER = Number.POSITIVE_INFINITY;

const go = (refs: readonly FlightRef[]): void => {
  window.location.hash = compareHash(refs);
};

export function ComparePage({ refs }: { refs: FlightRef[] }) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);

  const resolved = useQueries({
    queries: refs.map((ref) => ({
      queryKey: ['compare-ref', refKey(ref)],
      queryFn: () => resolveRef(ref),
      staleTime: FOREVER,
      retry: false,
    })),
  });
  const details = useQueries({
    queries: refs.map((ref, i) => {
      const flight = resolved[i]?.data ?? null;
      return {
        queryKey: ['compare-details', refKey(ref)],
        queryFn: ({ signal }: { signal: AbortSignal }) => (flight ? fetchCompareDetails(flight, signal) : Promise.resolve(null)),
        enabled: flight !== null,
        staleTime: FOREVER,
        retry: false,
      };
    }),
  });
  const tracks = useQueries({
    queries: refs.map((ref, i) => {
      const flight = resolved[i]?.data ?? null;
      return {
        queryKey: ['compare-track', refKey(ref)],
        queryFn: ({ signal }: { signal: AbortSignal }) => loadTrack(flight ? trackUrl(flight) : '', signal),
        enabled: flight !== null && details[i]?.data != null,
        staleTime: FOREVER,
        retry: false,
      };
    }),
  });

  /** Полёт не открыть: ссылку сбросили, полёт скрыт, трек не загрузился. */
  const failed = refs.filter(
    (_, i) =>
      resolved[i]?.isError === true ||
      (resolved[i]?.isSuccess === true && resolved[i]?.data === null) ||
      details[i]?.isError === true ||
      (details[i]?.isSuccess === true && details[i]?.data === null) ||
      tracks[i]?.isError === true,
  );
  const loading = refs.some((ref, i) => !failed.includes(ref) && tracks[i]?.data === undefined);

  // Список для сцены — стабильный, пока не пришли новые данные: смена пересоздаёт сцену.
  const readyKey = refs.map((ref, i) => (tracks[i]?.data ? refKey(ref) : '')).join(',');
  const flights = useMemo<CompareFlight[]>(() => {
    const out: CompareFlight[] = [];
    refs.forEach((ref, i) => {
      const track = tracks[i]?.data;
      const info = details[i]?.data;
      if (!track || !info) return;
      const date = info.startedAt
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: info.timezone ?? 'UTC' }).format(new Date(info.startedAt))
        : null;
      out.push({
        key: refKey(ref),
        track,
        color: compareColor(i),
        label: info.pilotName ?? fill(t('compare.flightN'), { n: String(i + 1) }),
        detail: [date, info.takeoffSite?.name].filter((part) => part != null).join(' · '),
        timezone: info.timezone,
      });
    });
    return out;
    // Ключ — состав загруженных треков и язык; сами запросы между рендерами не меняются.
  }, [readyKey, locale]);

  const remove = (key: string): void => go(refs.filter((ref) => refKey(ref) !== key));
  const add = (ref: FlightRef): void => go([...refs, ref]);
  // Подсказки — по первому открывшемуся полёту: его место и день задают «здесь и в этот день».
  const anchor = resolved.find((query) => query.data)?.data ?? null;
  const present = new Set(resolved.flatMap((query) => (query.data ? [query.data.flightId] : [])));
  const toolbar = (
    <>
      <CompareToolbar refs={refs} failed={failed} onAdd={add} onRemove={remove} />
      {anchor && refs.length < COMPARE_MAX_FLIGHTS && (
        <SameDaySuggestions anchor={anchor} present={present} onAdd={(flightId) => add({ kind: 'id', flightId })} />
      )}
    </>
  );

  if (refs.length === 0 || (!loading && flights.length === 0)) {
    return (
      <main lang={locale} className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold">{t('compare.title')}</h1>
        <p className="text-secondary">{t('compare.empty')}</p>
        {toolbar}
        <a href={LOGBOOK_HASH} className="text-accent">
          {t('logbook.title')}
        </a>
      </main>
    );
  }
  if (loading) {
    return (
      <p role="status" className="grid min-h-dvh place-items-center text-secondary">
        {t('compare.loading')}
      </p>
    );
  }
  return (
    <Suspense
      fallback={
        <p role="status" className="grid min-h-dvh place-items-center text-secondary">
          {t('viewer.loadingScene')}
        </p>
      }
    >
      <CompareScene flights={flights} onRemove={remove} toolbar={toolbar} />
    </Suspense>
  );
}

type AddNotice = 'invalid' | 'copied' | null;

/** Добавить полёт по ссылке, скопировать ссылку на сравнение, недоступные полёты. */
function CompareToolbar({
  refs,
  failed,
  onAdd,
  onRemove,
}: {
  refs: FlightRef[];
  failed: FlightRef[];
  onAdd: (ref: FlightRef) => void;
  onRemove: (key: string) => void;
}) {
  const t = useT();
  const [link, setLink] = useState('');
  const [notice, setNotice] = useState<AddNotice>(null);
  const full = refs.length >= COMPARE_MAX_FLIGHTS;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const ref = refFromLink(link);
    if (!ref) {
      setNotice('invalid');
      return;
    }
    setLink('');
    setNotice(null);
    onAdd(ref);
  };
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${compareHash(refs)}`);
      setNotice('copied');
    } catch {
      setNotice(null);
    }
  };

  return (
    <div data-panel="compare-toolbar" className="flex flex-col gap-2 text-sm">
      {failed.map((ref) => (
        <p key={refKey(ref)} className="flex items-center justify-between gap-2 text-xs text-danger">
          <span>{t('compare.unavailable')}</span>
          <button
            type="button"
            aria-label={t('compare.remove')}
            onClick={() => onRemove(refKey(ref))}
            className="rounded px-2 text-secondary hover:text-primary compact:min-h-11"
          >
            ×
          </button>
        </p>
      ))}
      {full ? (
        <p className="text-xs text-secondary">{fill(t('compare.full'), { max: String(COMPARE_MAX_FLIGHTS) })}</p>
      ) : (
        <form onSubmit={submit} className="flex gap-2">
          <input
            type="url"
            inputMode="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder={t('compare.addPlaceholder')}
            aria-label={t('compare.addPlaceholder')}
            className="min-w-0 flex-1 rounded bg-subtle px-2 py-1 text-primary placeholder:text-secondary compact:min-h-11"
          />
          <button type="submit" className="rounded bg-accent px-3 py-1 font-semibold text-void compact:min-h-11">
            {t('compare.add')}
          </button>
        </form>
      )}
      {refs.length > 0 && (
        <button type="button" onClick={() => void copy()} className="self-start text-xs text-accent compact:min-h-11">
          {t('compare.copyLink')}
        </button>
      )}
      {notice !== null && (
        <p role="status" className={`text-xs ${notice === 'invalid' ? 'text-danger' : 'text-secondary'}`}>
          {t(notice === 'invalid' ? 'compare.addInvalid' : 'compare.copied')}
        </p>
      )}
    </div>
  );
}

/**
 * «Ещё летали здесь в этот день» (задача 3.12в): публичные полёты того же
 * места и дня плюс свои. Уже добавленные не повторяются.
 */
function SameDaySuggestions({
  anchor,
  present,
  onAdd,
}: {
  anchor: ResolvedFlight;
  present: ReadonlySet<string>;
  onAdd: (flightId: string) => void;
}) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const suggestions = useQuery({
    queryKey: ['compare-same-day', anchor.flightId, anchor.share],
    queryFn: ({ signal }) => fetchSameDay(anchor, signal),
    staleTime: FOREVER,
    retry: false,
  });
  const shown = (suggestions.data ?? []).filter((flight) => !present.has(flight.flightId));
  if (shown.length === 0) return null;
  return (
    <section data-panel="compare-same-day" className="flex flex-col gap-1 border-t border-subtle pt-2 text-sm">
      <h2 className="text-xs text-secondary">{t('compare.sameDay')}</h2>
      <ul className="flex flex-col gap-1">
        {shown.map((flight) => (
          <li key={flight.flightId}>
            <button
              type="button"
              onClick={() => onAdd(flight.flightId)}
              aria-label={`${t('compare.addFlight')}: ${suggestionLabel(flight, t)}`}
              className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-subtle compact:min-h-11"
            >
              <span aria-hidden className="text-accent">
                +
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-primary">
                  {suggestionLabel(flight, t)}
                  {flight.own && <span className="ml-1 text-xs text-secondary">· {t('compare.own')}</span>}
                </span>
                <span className="numeric block truncate text-xs text-secondary">{suggestionDetail(flight, locale, t)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const suggestionLabel = (flight: SameDayFlight, t: (key: MessageKey) => string): string =>
  flight.pilotName ?? t('compare.unknownPilot');

/** «12:40 · 50 мин · 12,3 км»: местное время старта, время в воздухе, дистанция. */
function suggestionDetail(flight: SameDayFlight, locale: Locale, t: (key: MessageKey) => string): string {
  const time = flight.startedAt
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: flight.timezone ?? 'UTC' }).format(
        new Date(flight.startedAt),
      )
    : null;
  const airtime = flight.airtimeS === null ? null : formatDuration(flight.airtimeS, t);
  const distance = flight.distanceTrackM === null ? null : kilometres(flight.distanceTrackM, locale, t);
  return [time, airtime, distance].filter((part) => part !== null).join(' · ');
}
