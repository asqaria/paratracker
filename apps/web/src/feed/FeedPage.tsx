import type { FeedItem, FeedScope } from '@skyline/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useMe } from '../auth/session';
import { UserMenu } from '../auth/UserMenu';
import { LocaleSwitch } from '../i18n/LocaleSwitch';
import { useLocaleStore, useT } from '../i18n/locale';
import { flightHash, profileHash } from '../routing';
import { formatDuration } from '../viewer/format-summary';
import { kilometres } from '../viewer/units';
import { FEED_QUERY_KEY, fetchFeed, previewUrl } from './feed-api';
import { LikeButton } from './LikeButton';

/**
 * Лента сообщества (задача 3.10а, ТЗ §8.2 /feed): полёты «Все» — новые сверху.
 * «Подписки» — пилоты, на которых подписан вошедший; «Все» — все пилоты.
 */
export function FeedPage() {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const me = useMe();
  // Без входа подписок нет — сразу «Все»; вошедшему — сначала его подписки.
  const [chosen, setChosen] = useState<FeedScope | null>(null);
  const scope: FeedScope = chosen ?? (me ? 'following' : 'all');
  const feed = useInfiniteQuery({
    queryKey: [...FEED_QUERY_KEY, scope, me?.id ?? null],
    queryFn: ({ pageParam }) => fetchFeed(scope, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: me !== undefined,
  });
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <main lang={locale} className="mx-auto min-h-dvh w-full max-w-5xl p-6 compact:p-3">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">
          <a href="#/">{t('app.name')}</a>
          <span className="ml-3 font-normal text-secondary">{t('feed.title')}</span>
        </h1>
        <div className="flex items-center gap-3">
          <UserMenu />
          <LocaleSwitch />
        </div>
      </header>

      {me && (
        <div role="tablist" aria-label={t('feed.title')} className="mb-4 flex gap-1 text-sm">
          {(['following', 'all'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={scope === value}
              onClick={() => setChosen(value)}
              className="rounded px-3 py-1 text-secondary aria-selected:bg-subtle aria-selected:text-primary compact:min-h-11"
            >
              {t(`feed.scope.${value}`)}
            </button>
          ))}
        </div>
      )}

      {feed.isPending && me !== undefined && (
        <p role="status" className="text-secondary">
          {t('feed.loading')}
        </p>
      )}
      {feed.isError && (
        <p role="alert" className="text-danger">
          {t('feed.error')}
        </p>
      )}
      {feed.isSuccess && items.length === 0 && (
        <p className="text-secondary">{t(scope === 'following' ? 'feed.emptyFollowing' : 'feed.empty')}</p>
      )}

      <ul data-panel="feed" className="grid grid-cols-2 gap-4 compact:grid-cols-1">
        {items.map((item) => (
          <FeedCard key={item.flightId} item={item} />
        ))}
      </ul>
      {feed.hasNextPage && (
        <button
          type="button"
          onClick={() => void feed.fetchNextPage()}
          disabled={feed.isFetchingNextPage}
          className="mt-4 w-full rounded bg-subtle py-2 text-sm disabled:opacity-50"
        >
          {t('feed.more')}
        </button>
      )}
    </main>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const pilotName = item.pilot.displayName ?? item.pilot.username;
  const date = item.startedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: item.timezone ?? 'UTC' }).format(new Date(item.startedAt))
    : null;
  const numbers = [
    item.airtimeS === null ? null : formatDuration(item.airtimeS, t),
    item.distanceTrackM === null ? null : kilometres(item.distanceTrackM, locale, t),
    item.xcScore === null
      ? null
      : `XC ${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(item.xcScore)} ${t('profile.points')}`,
  ].filter((part) => part !== null);

  return (
    <li data-feed-card className="overflow-hidden rounded-xl glass">
      <a href={flightHash(item.flightId)} className="block">
        {item.hasPreview ? (
          <img
            src={previewUrl(item.flightId)}
            alt=""
            loading="lazy"
            width={1200}
            height={630}
            className="aspect-[1200/630] w-full bg-subtle object-cover"
          />
        ) : (
          <span aria-hidden className="block aspect-[1200/630] w-full bg-subtle" />
        )}
      </a>
      <div className="flex flex-col gap-1 p-3 text-sm">
        <div className="flex items-center gap-2">
          {item.pilot.avatarUrl !== null && (
            <img src={item.pilot.avatarUrl} alt="" width={24} height={24} referrerPolicy="no-referrer" className="rounded-full" />
          )}
          <a href={profileHash(item.pilot.username)} className="truncate font-semibold hover:text-accent">
            {pilotName}
          </a>
          <span className="ml-auto flex items-center gap-1">
            {item.commentCount > 0 && (
              <a
                href={flightHash(item.flightId)}
                aria-label={`${t('comments.title')}: ${item.commentCount}`}
                className="numeric px-1 text-sm text-secondary hover:text-primary"
              >
                💬 {item.commentCount}
              </a>
            )}
            <LikeButton flightId={item.flightId} likeCount={item.likeCount} likedByMe={item.likedByMe} />
          </span>
        </div>
        <a href={flightHash(item.flightId)} className="text-secondary hover:text-primary">
          {[date, item.siteName].filter((part) => part !== null).join(' · ')}
        </a>
        <p className="numeric text-primary">{numbers.join(' · ')}</p>
      </div>
    </li>
  );
}
