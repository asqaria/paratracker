import type { ProfileTotals, PublicProfileResponse } from '@skyline/core';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useMe } from '../auth/session';
import { UserMenu } from '../auth/UserMenu';
import { compareHash } from '../compare/compare-refs';
import { LocaleSwitch } from '../i18n/LocaleSwitch';
import { fill, useLocaleStore, useT } from '../i18n/locale';
import type { MessageKey } from '../i18n/messages';
import { LogbookList } from '../logbook/LogbookList';
import { SETTINGS_HASH } from '../routing';
import { formatDuration } from '../viewer/format-summary';
import { kilometres, metres } from '../viewer/units';
import { FEED_QUERY_KEY, setFollow } from '../feed/feed-api';
import { fetchProfile, fetchProfileFlights, profileKey } from './profile-api';

/**
 * Публичный профиль пилота (задача 3.11, ТЗ §8.2 /u/:username): кто он, итоги
 * и список — только по полётам «Все». Полёты отсюда можно сравнить (3.12).
 */

const MISSING = '—';

export function ProfilePage({ username }: { username: string }) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const me = useMe();
  const profile = useQuery({ queryKey: profileKey(username), queryFn: () => fetchProfile(username), retry: false });
  const list = useInfiniteQuery({
    queryKey: [...profileKey(username), 'flights'],
    queryFn: ({ pageParam }) => fetchProfileFlights(username, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: profile.data != null,
  });
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const own = me != null && profile.data != null && me.username === profile.data.username;

  return (
    <main lang={locale} className="mx-auto min-h-dvh w-full max-w-4xl p-6 compact:p-3">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">
          <a href="#/">{t('app.name')}</a>
        </h1>
        <div className="flex items-center gap-3">
          <UserMenu />
          <LocaleSwitch />
        </div>
      </header>

      {profile.status === 'pending' && (
        <p role="status" className="text-secondary">
          {t('profile.loading')}
        </p>
      )}
      {(profile.status === 'error' || profile.data === null) && (
        <p role="alert" className="text-secondary">
          {t('profile.notFound')}
        </p>
      )}
      {profile.data && (
        <div className="flex flex-col gap-6">
          <section data-panel="profile-card" className="flex flex-wrap items-center gap-4">
            {profile.data.avatarUrl ? (
              <img src={profile.data.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-16 w-16 rounded-full" />
            ) : (
              <span aria-hidden className="grid h-16 w-16 place-items-center rounded-full bg-subtle text-2xl text-secondary">
                {(profile.data.displayName ?? profile.data.username).slice(0, 1).toUpperCase()}
              </span>
            )}
            <div>
              <h2 className="text-xl font-semibold">{profile.data.displayName ?? profile.data.username}</h2>
              <p className="text-sm text-secondary">
                @{profile.data.username} ·{' '}
                {fill(t('profile.since'), {
                  date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
                    new Date(profile.data.memberSince),
                  ),
                })}
              </p>
              <p data-panel="profile-follows" className="numeric text-sm text-secondary">
                {t('follow.followers')}: {profile.data.followers} · {t('follow.following')}: {profile.data.following}
              </p>
            </div>
            {me && !own && <FollowButton profile={profile.data} />}
          </section>

          <ProfileTotalsView totals={profile.data.totals} />

          {own && (
            <p className="text-xs text-secondary">
              {t('profile.ownHint')}{' '}
              <a href={SETTINGS_HASH} className="text-accent">
                {t('settings.title')}
              </a>
            </p>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">{t('profile.flights')}</h2>
            {list.isSuccess && items.length === 0 && <p className="text-sm text-secondary">{t('profile.empty')}</p>}
            {selected.size > 0 && (
              <a
                href={compareHash([...selected].map((flightId) => ({ kind: 'id' as const, flightId })))}
                className="self-start rounded bg-accent px-3 py-1.5 font-semibold text-void compact:min-h-11"
              >
                {fill(t('compare.open'), { n: String(selected.size) })}
              </a>
            )}
            {items.length > 0 && (
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
            )}
          </section>
        </div>
      )}
    </main>
  );
}

/** Итоги по публичным полётам: всё время, в единицах пилота. */
export function ProfileTotalsView({ totals }: { totals: ProfileTotals }) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const orMissing = <T,>(value: T | null, format: (v: T) => string): string => (value === null ? MISSING : format(value));
  const items: { label: MessageKey; value: string }[] = [
    { label: 'profile.stats.flights', value: new Intl.NumberFormat(locale).format(totals.flights) },
    { label: 'profile.stats.airtime', value: formatDuration(totals.airtimeS, t) },
    { label: 'profile.stats.distance', value: kilometres(totals.distanceM, locale, t) },
    { label: 'profile.stats.maxAlt', value: orMissing(totals.maxAltM, (m) => metres(m, locale, t)) },
    { label: 'profile.stats.longest', value: orMissing(totals.longestAirtimeS, (s) => formatDuration(s, t)) },
    {
      label: 'profile.stats.bestXc',
      value: orMissing(
        totals.bestXcScore,
        (score) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(score)} ${t('profile.points')}`,
      ),
    },
  ];
  return (
    <dl data-panel="profile-totals" className="grid grid-cols-3 gap-4 rounded-xl glass p-4 compact:grid-cols-2 compact:p-3">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col">
          <dt className="text-xs text-secondary">{t(item.label)}</dt>
          <dd className="numeric text-lg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Подписка на пилота (задача 3.10а): его полёты «Все» попадут во вкладку «Подписки». */
function FollowButton({ profile }: { profile: PublicProfileResponse }) {
  const t = useT();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const toggle = (): void => {
    setBusy(true);
    setFollow(profile.username, !profile.followedByMe)
      .then((state) => {
        client.setQueryData(profileKey(profile.username), {
          ...profile,
          followedByMe: state.following,
          followers: state.followers,
        });
        return client.invalidateQueries({ queryKey: FEED_QUERY_KEY });
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <button
      type="button"
      data-follow
      aria-pressed={profile.followedByMe}
      disabled={busy}
      onClick={toggle}
      className={`ml-auto rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50 compact:min-h-11 ${
        profile.followedByMe ? 'bg-subtle text-primary' : 'bg-accent text-void'
      }`}
    >
      {t(profile.followedByMe ? 'follow.unfollow' : 'follow.follow')}
    </button>
  );
}
