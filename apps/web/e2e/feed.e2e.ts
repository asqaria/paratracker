import { expect, test, type Page } from '@playwright/test';

/**
 * Лента, лайки и подписки (задача 3.10а). API подменён: проверяются вкладки,
 * карточки, лайк со счётчиком и подписка в профиле; раскладка на телефоне.
 */

const FLIGHT = '22222222-2222-4333-8444-555555555555';
const ME = {
  id: '11111111-2222-4333-8444-555555555555',
  username: 'viewer',
  displayName: 'Смотрящий',
  avatarUrl: null,
  locale: 'ru',
  units: 'metric',
  defaultPrivacy: 'unlisted',
};
const ITEM = {
  flightId: FLIGHT,
  pilot: { username: 'aigerim', displayName: 'Айгерим', avatarUrl: null },
  startedAt: '2026-07-15T06:00:00.000Z',
  timezone: 'Asia/Almaty',
  siteName: 'Ush Konyr',
  airtimeS: 3600,
  distanceTrackM: 40_000,
  maxAltM: 3000,
  xcScore: 55.5,
  likeCount: 2,
  likedByMe: false,
  hasPreview: false,
};
const PROFILE = {
  username: 'aigerim',
  displayName: 'Айгерим',
  avatarUrl: null,
  memberSince: '2026-09-01T00:00:00.000Z',
  totals: { flights: 1, airtimeS: 3600, distanceM: 40_000, maxAltM: 3000, longestAirtimeS: 3600, longestDistanceM: 40_000, bestXcScore: 55.5 },
  followers: 0,
  following: 0,
  followedByMe: false,
};

async function mockApi(page: Page, signedIn: boolean): Promise<string[]> {
  const calls: string[] = [];
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: { status: 404 } }));
  await page.route('**/api/v1/me', (route) =>
    signedIn ? route.fulfill({ json: ME }) : route.fulfill({ status: 401, json: { status: 401 } }),
  );
  await page.route('**/api/v1/feed?*', (route) => {
    const scope = new URL(route.request().url()).searchParams.get('scope');
    calls.push(`feed:${scope ?? ''}`);
    return route.fulfill({ json: { items: scope === 'following' ? [] : [ITEM], nextCursor: null } });
  });
  await page.route(`**/api/v1/flights/${FLIGHT}/like`, (route) => {
    calls.push(`like:${route.request().method()}`);
    return route.fulfill({ json: { liked: route.request().method() === 'POST', likeCount: 3 } });
  });
  await page.route('**/api/v1/users/aigerim', (route) => route.fulfill({ json: PROFILE }));
  await page.route('**/api/v1/users/aigerim/flights', (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route('**/api/v1/users/aigerim/follow', (route) => {
    calls.push(`follow:${route.request().method()}`);
    return route.fulfill({ json: { following: true, followers: 1 } });
  });
  return calls;
}

test('без входа: «Все», карточка с пилотом и цифрами; лайк недоступен', async ({ page }) => {
  const calls = await mockApi(page, false);
  await page.goto('/#/feed');
  const card = page.locator('[data-feed-card]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Айгерим');
  await expect(card).toContainText('Ush Konyr');
  await expect(card.locator('[data-like]')).toBeDisabled();
  await expect(page.getByRole('tab')).toHaveCount(0);
  expect(calls).toEqual(['feed:all']);
});

test('вошёл: сначала «Подписки» (пусто — подсказка), «Все» — лайк со счётчиком', async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto('/#/feed');
  await expect(page.getByRole('tab', { name: /Подписки|Following/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-feed-card]')).toHaveCount(0);
  await page.getByRole('tab', { name: /^(Все|Everyone)$/ }).click();
  const like = page.locator('[data-feed-card] [data-like]');
  await expect(like).toHaveText(/2/);
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await expect(like).toHaveText(/3/);
  expect(calls).toEqual(['feed:following', 'feed:all', 'like:POST']);
});

test('профиль: «Подписаться» — число подписчиков растёт, кнопка — «Отписаться»', async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto('/#/u/aigerim');
  const follow = page.locator('[data-follow]');
  await expect(follow).toHaveText(/Подписаться|Follow/);
  await follow.click();
  await expect(follow).toHaveText(/Отписаться|Unfollow/);
  await expect(page.locator('[data-panel="profile-follows"]')).toContainText('1');
  expect(calls).toContain('follow:POST');
});

test('телефон: карточки в одну колонку, страница не шире экрана', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, false);
  await page.goto('/#/feed');
  await expect(page.locator('[data-feed-card]')).toHaveCount(1);
  const box = await page.locator('[data-feed-card]').boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
