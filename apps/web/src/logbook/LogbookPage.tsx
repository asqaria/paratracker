import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';

import { useMe } from '../auth/session';
import { UserMenu } from '../auth/UserMenu';
import { LocaleSwitch } from '../i18n/LocaleSwitch';
import { useLocaleStore, useT } from '../i18n/locale';
import { fetchImageryCapabilities } from '../viewer/imagery-capabilities';
import { fetchLogbookMap, fetchLogbookPage } from './fetch-logbook';
import { LOGBOOK_QUERY_KEY } from './logbook-keys';
import { LogbookList } from './LogbookList';

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
  const list = useInfiniteQuery({
    queryKey: [...LOGBOOK_QUERY_KEY, 'list'],
    queryFn: ({ pageParam }) => fetchLogbookPage(pageParam),
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
  if (items.length === 0) {
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
      {features.length > 0 && map.data && (
        <Suspense fallback={<div className="h-72 rounded-xl bg-subtle compact:h-56" />}>
          <LogbookMap data={map.data} esriTileUrl={imagery.data?.esri === true ? esriTileUrl() : null} />
        </Suspense>
      )}
      <section className="rounded-xl glass p-4 compact:p-2">
        <LogbookList
          items={items}
          hasMore={list.hasNextPage}
          loadingMore={list.isFetchingNextPage}
          onMore={() => void list.fetchNextPage()}
        />
      </section>
    </div>
  );
}
