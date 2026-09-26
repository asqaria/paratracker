import { gliderLabel } from '@skyline/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';

import { useMe } from '../auth/session';
import { UserMenu } from '../auth/UserMenu';
import { LocaleSwitch } from '../i18n/LocaleSwitch';
import { fill, useLocaleStore, useT } from '../i18n/locale';
import { fetchGliders, GLIDERS_QUERY_KEY } from '../gliders/gliders-api';
import { compareHash } from '../compare/compare-refs';
import { SETTINGS_HASH } from '../routing';
import { fetchLogbookSites, PGE_URL } from '../sites/create-site';
import { fetchImageryCapabilities } from '../viewer/imagery-capabilities';
import { fetchLogbookMap, fetchLogbookPage, fetchSeasonStats, NO_FILTERS, type LogbookFilters } from './fetch-logbook';
import { LOGBOOK_QUERY_KEY } from './logbook-keys';
import { LogbookList } from './LogbookList';
import { SeasonStatsView } from './SeasonStats';

/** MapLibre — ленивый чанк: в начальный бандл не попадает (ТЗ §7.7). */
const LogbookMap = lazy(() => import('./LogbookMap'));

/** Пока в логбуке есть полёт в обработке, список опрашивается — без перезагрузки. */
const PROCESSING_POLL_MS = 5000;

/** Тот же шаблон прокси Esri, что у 3D-сцены (VITE_ESRI_TILE_URL, providers.ts). */
const esriTileUrl = (): string | null => {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = (env.VITE_ESRI_TILE_URL ?? '').trim();
  return value === '' ? null : value;
};

/** Логбук (задача 2.11, ТЗ §8.2 /logbook): карта всех полётов и список. */
export function LogbookPage() {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const me = useMe();

  return (
    <main lang={locale} className="mx-auto min-h-dvh w-full max-w-4xl p-6 compact:p-3">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">
          <a href="#/">{t('app.name')}</a>
          <span className="ml-3 font-normal text-secondary">{t('logbook.title')}</span>
        </h1>
        <div className="flex items-center gap-3">
          <UserMenu />
          <LocaleSwitch />
        </div>
      </header>
      {me === null && <p className="text-secondary">{t('logbook.signInPrompt')}</p>}
      {me && <LogbookContent />}
    </main>
  );
}

function LogbookContent() {
  const t = useT();
  /** Фильтры по месту старта (2.13а) и крылу (2.13б); null — все. */
  const [filters, setFilters] = useState<LogbookFilters>(NO_FILTERS);
  /** Год статистики; null — последний, в котором пилот летал. */
  const [year, setYear] = useState<number | null>(null);
  /** Отмеченные для сравнения треков (задача 3.12). */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const stats = useQuery({ queryKey: [...LOGBOOK_QUERY_KEY, 'stats', year], queryFn: () => fetchSeasonStats(year) });
  const sites = useQuery({ queryKey: [...LOGBOOK_QUERY_KEY, 'sites'], queryFn: () => fetchLogbookSites() });
  const gliders = useQuery({ queryKey: GLIDERS_QUERY_KEY, queryFn: () => fetchGliders() });
  const list = useInfiniteQuery({
    queryKey: [...LOGBOOK_QUERY_KEY, 'list', filters],
    queryFn: ({ pageParam }) => fetchLogbookPage(pageParam, filters),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some((f) => f.status !== 'ready' && f.status !== 'failed'))
        ? PROCESSING_POLL_MS
        : false,
  });
  const map = useQuery({ queryKey: [...LOGBOOK_QUERY_KEY, 'map'], queryFn: () => fetchLogbookMap() });
  const imagery = useQuery({
    queryKey: ['imagery-capabilities'],
    queryFn: ({ signal }) => fetchImageryCapabilities(signal),
    staleTime: Infinity,
  });

  if (list.status === 'pending') return <p role="status" className="text-secondary">{t('logbook.loading')}</p>;
  if (list.status === 'error') return <p role="alert" className="text-danger">{t('logbook.error')}</p>;

  const items = list.data.pages.flatMap((page) => page.items);
  if (items.length === 0 && filters === NO_FILTERS) {
    return (
      <div className="rounded-xl glass p-8 text-center">
        <p className="text-secondary">{t('logbook.empty')}</p>
        <a href="#/" className="mt-4 inline-block rounded bg-subtle px-3 py-1 text-sm">
          {t('logbook.upload')}
        </a>
      </div>
    );
  }

  const features = map.data?.features ?? [];
  return (
    <div className="flex flex-col gap-4">
      {stats.data && <SeasonStatsView stats={stats.data} onYear={setYear} />}
      {features.length > 0 && map.data && (
        <Suspense fallback={<div className="h-72 rounded-xl bg-subtle compact:h-56" />}>
          <LogbookMap data={map.data} esriTileUrl={imagery.data?.esri === true ? esriTileUrl() : null} />
        </Suspense>
      )}
      <section className="rounded-xl glass p-4 compact:p-2">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          {(sites.data?.sites.length ?? 0) > 0 && (
            <select
              aria-label={t('logbook.siteFilter')}
              value={filters.siteId ?? ''}
              onChange={(event) => setFilters({ ...filters, siteId: event.target.value === '' ? null : event.target.value })}
              className="rounded bg-subtle px-2 py-1 text-primary"
            >
              <option value="">{t('logbook.allSites')}</option>
              {sites.data?.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {`${site.name} (${site.flightCount})`}
                </option>
              ))}
            </select>
          )}
          {(gliders.data?.length ?? 0) > 1 && (
            <select
              aria-label={t('logbook.gliderFilter')}
              value={filters.gliderId ?? ''}
              onChange={(event) => setFilters({ ...filters, gliderId: event.target.value === '' ? null : event.target.value })}
              className="rounded bg-subtle px-2 py-1 text-primary"
            >
              <option value="">{t('logbook.allGliders')}</option>
              {gliders.data?.map((glider) => (
                <option key={glider.id} value={glider.id}>
                  {gliderLabel(glider)}
                </option>
              ))}
            </select>
          )}
          <a href={SETTINGS_HASH} className="ml-auto text-accent">
            {t('gliders.title')}
          </a>
        </div>
        {selected.size > 0 ? (
          <a
            data-panel="compare-selected"
            href={compareHash([...selected].map((flightId) => ({ kind: 'id' as const, flightId })))}
            className="mb-3 inline-block rounded bg-accent px-3 py-1.5 font-semibold text-void compact:min-h-11"
          >
            {fill(t('compare.open'), { n: String(selected.size) })}
          </a>
        ) : (
          <p className="mb-3 text-xs text-secondary">{t('compare.selectHint')}</p>
        )}
        <LogbookList
          items={items}
          hasMore={list.hasNextPage}
          loadingMore={list.isFetchingNextPage}
          onMore={() => void list.fetchNextPage()}
          selected={selected}
          onToggle={(flightId) =>
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(flightId)) next.delete(flightId);
              else next.add(flightId);
              return next;
            })
          }
        />
      </section>
      {/* Места из paragliding.earth — CC BY-SA 3.0: ссылка на источник обязательна. */}
      <p className="text-xs text-secondary">
        {t('site.attributionPrefix')}{' '}
        <a href={PGE_URL} target="_blank" rel="noreferrer" className="hover:text-accent">
          paragliding.earth
        </a>{' '}
        (CC BY-SA 3.0)
      </p>
    </div>
  );
}
