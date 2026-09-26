import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

/**
 * Сравнение треков (задача 3.12): #/compare?f=… — свой полёт по id и чужой
 * по токену ссылки. API подменён: оба ведут на демо-трек, внешняя сеть
 * закрыта — проверяются состав, подписи, управление и раскладка.
 */

const A = '11111111-2222-4333-8444-555555555555';
const B = '22222222-2222-4333-8444-555555555555';
const TOKEN = 'shareToken_12';
const DEMO_TRACK = readFileSync(new URL('../public/demo/baseline.track', import.meta.url));

const details = (flightId: string, pilotName: string | null) => ({
  flightId,
  status: 'ready',
  analysisLevel: 'full',
  startedAt: '2026-07-15T06:00:00.000Z',
  endedAt: '2026-07-15T07:00:00.000Z',
  timezone: 'Asia/Almaty',
  durationS: 3600,
  thermalCount: 2,
  avgClimbMs: 1.5,
  avgGlideRatio: 7,
  wind: null,
  takeoffSite: { id: '33333333-2222-4333-8444-555555555555', name: 'Ush Konyr', countryCode: 'kz', source: 'seed' },
  landingSite: null,
  xc: null,
  glider: null,
  gliderRaw: null,
  pilotName,
  canEdit: false,
  privacy: 'unlisted',
});

async function openCompare(page: Page, hash = `#/compare?f=${A},${TOKEN}`): Promise<void> {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: { status: 404 } }));
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 401, json: { status: 401 } }));
  await page.route('**/api/v1/imagery', (route) => route.fulfill({ json: { esri: true } }));
  await page.route(`**/api/v1/share/${TOKEN}`, (route) => route.fulfill({ json: { flightId: B } }));
  await page.route(`**/api/v1/flights/${A}`, (route) => route.fulfill({ json: details(A, 'Айгерим') }));
  await page.route(`**/api/v1/flights/${B}?share=${TOKEN}`, (route) => route.fulfill({ json: details(B, null) }));
  for (const track of [`**/api/v1/flights/${A}/track`, `**/api/v1/flights/${B}/track?share=${TOKEN}`]) {
    await page.route(track, (route) => route.fulfill({ body: DEMO_TRACK, contentType: 'application/octet-stream' }));
  }
  await page.goto(`/${hash}`);
  await expect(page.locator('[data-panel="compare-list"]')).toBeVisible({ timeout: 30_000 });
}

const VIEWPORTS = [
  { name: 'десктоп', width: 1440, height: 900, compact: false },
  { name: 'телефон', width: 390, height: 844, compact: true },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.compact });

    test('оба пилота в списке: имя из профиля или «Полёт N», место; атрибуция и управление на месте', async ({ page }) => {
      await openCompare(page);
      const list = page.locator('[data-panel="compare-list"] li');
      await expect(list).toHaveCount(2);
      await expect(list.nth(0)).toContainText('Айгерим');
      await expect(list.nth(1)).toContainText(/Полёт 2|Flight 2/);
      await expect(list.nth(0)).toContainText('Ush Konyr');
      await expect(page.locator('[data-panel="attribution"]')).toBeVisible();
      await expect(page.locator('[data-panel="timeline"]')).toBeVisible();
      // Один день — реальное время по умолчанию.
      await expect(page.getByRole('button', { name: /^(Реальное|Real)$/ })).toHaveAttribute('aria-pressed', 'true');
    });

    test('список и управление не наезжают друг на друга, страница не шире экрана', async ({ page }) => {
      await openCompare(page);
      const list = await page.locator('[data-panel="compare-list"]').boundingBox();
      const controls = await page.locator('[data-panel="timeline"]').boundingBox();
      expect(list && controls).toBeTruthy();
      if (!list || !controls) return;
      expect(list.y + list.height).toBeLessThanOrEqual(controls.y);
      expect(list.x + list.width).toBeLessThanOrEqual(viewport.width + 1);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
    });
  });
}

test('убрать пилота — состав в адресе меняется', async ({ page }) => {
  await openCompare(page);
  await page.getByRole('button', { name: /(Убрать из сравнения|Remove from comparison): Айгерим/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/compare\\?f=${TOKEN}$`));
});

test('добавить: не ссылка на полёт — сообщение; ссылка «поделиться» — в адрес', async ({ page }) => {
  await openCompare(page, `#/compare?f=${A}`);
  const input = page.getByRole('textbox');
  await input.fill('https://example.com/');
  await input.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: /Skyline/ })).toBeVisible();
  await input.fill(`https://skyline.gateapp.kz/s/${TOKEN}`);
  await input.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/compare\\?f=${A},${TOKEN}$`));
});

test('недоступная ссылка — пометка в списке, остальные полёты на сцене', async ({ page }) => {
  await openCompare(page, `#/compare?f=${A},goneToken_1`);
  await expect(page.locator('[data-panel="compare-list"] li')).toHaveCount(1);
  await expect(page.locator('[data-panel="compare-toolbar"]')).toContainText(/недоступен|unavailable/);
});
