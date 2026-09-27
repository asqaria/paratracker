import { expect, test, type Page } from '@playwright/test';

/**
 * Публичный профиль пилота и его настройки (задача 3.11). API подменён:
 * проверяются карточка, итоги, список со сравнением и сохранение настроек.
 */

const FLIGHT = '22222222-2222-4333-8444-555555555555';
const ME = {
  id: '11111111-2222-4333-8444-555555555555',
  username: 'asqar.t',
  displayName: 'Асқар',
  avatarUrl: null,
  locale: 'ru',
  units: 'metric',
  defaultPrivacy: 'unlisted',
};
const PROFILE = {
  username: 'asqar.t',
  displayName: 'Асқар',
  avatarUrl: null,
  memberSince: '2026-09-01T00:00:00.000Z',
  totals: {
    flights: 1,
    airtimeS: 3600,
    distanceM: 40_000,
    maxAltM: 3000,
    longestAirtimeS: 3600,
    longestDistanceM: 40_000,
    bestXcScore: 55.5,
  },
};
const ENTRY = {
  id: FLIGHT,
  status: 'ready',
  startedAt: '2026-07-15T06:00:00.000Z',
  uploadedAt: '2026-07-15T09:00:00.000Z',
  timezone: 'Asia/Almaty',
  durationS: 3600,
  distanceTrackM: 40_000,
  maxAltM: 3000,
  thermalCount: 5,
  takeoffSite: null,
  glider: null,
};

async function mockApi(page: Page, signedIn: boolean): Promise<void> {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: { status: 404 } }));
  await page.route('**/api/v1/me', (route) =>
    signedIn ? route.fulfill({ json: ME }) : route.fulfill({ status: 401, json: { status: 401 } }),
  );
  await page.route('**/api/v1/users/asqar.t', (route) => route.fulfill({ json: PROFILE }));
  await page.route('**/api/v1/users/asqar.t/flights', (route) => route.fulfill({ json: { items: [ENTRY], nextCursor: null } }));
  await page.route('**/api/v1/gliders', (route) => route.fulfill({ json: { gliders: [] } }));
}

test('профиль без входа: имя, итоги, публичный полёт; отмеченный — в сравнение', async ({ page }) => {
  await mockApi(page, false);
  await page.goto('/#/u/Asqar.T');
  await expect(page.locator('[data-panel="profile-card"]')).toContainText('Асқар');
  await expect(page.locator('[data-panel="profile-card"]')).toContainText('@asqar.t');
  await expect(page.locator('[data-panel="profile-totals"]')).toContainText(/55[,.]5/);
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('link', { name: /Сравнить \(1\)|Compare \(1\)/ })).toHaveAttribute('href', `#/compare?f=${FLIGHT}`);
  // Подсказка про видимость — только владельцу.
  await expect(page.getByText(/Здесь видны только полёты|Only “Everyone” flights are shown/)).toHaveCount(0);
});

test('нет такого пилота — сообщение', async ({ page }) => {
  await mockApi(page, false);
  await page.goto('/#/u/nobody');
  await expect(page.getByRole('alert')).toBeVisible();
});

test('настройки: сохранить имя, адрес и видимость; занятый адрес — сообщение', async ({ page }) => {
  await mockApi(page, true);
  const patches: unknown[] = [];
  await page.route('**/api/v1/me', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fulfill({ json: ME });
    const body: unknown = route.request().postDataJSON();
    patches.push(body);
    const username = (body as { username?: string }).username;
    return username === 'taken'
      ? route.fulfill({ status: 409, json: { status: 409 } })
      : route.fulfill({ json: { ...ME, ...(body as object) } });
  });
  await page.goto('/#/settings');
  const form = page.locator('[data-panel="profile-settings"]');
  await expect(form).toBeVisible();
  await form.getByRole('textbox').nth(0).fill('Асқар Т.');
  await form.getByRole('button', { name: /^(Все|Everyone)$/ }).click();
  await form.getByRole('button', { name: /Сохранить|Save/ }).click();
  await expect(form.getByRole('status')).toBeVisible();
  expect(patches[0]).toEqual({ displayName: 'Асқар Т.', username: 'asqar.t', defaultPrivacy: 'public' });

  await form.getByRole('textbox').nth(1).fill('taken');
  await form.getByRole('button', { name: /Сохранить|Save/ }).click();
  await expect(form.getByRole('alert')).toBeVisible();
});
