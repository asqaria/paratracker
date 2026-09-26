import { expect, test, type Page } from '@playwright/test';

/**
 * Логбук (задача 2.11): вошедший видит карту и список, на телефоне страница
 * не шире экрана; после входа браузер забирает анонимные загрузки. API
 * подменён: проверяются экран и поведение фронта, а не сервер.
 */

const FLIGHT = '11111111-2222-4333-8444-555555555555';
const ANONYMOUS = '22222222-2222-4333-8444-555555555555';
const ME = { id: FLIGHT, username: 'asqar', displayName: 'Асқар Дүйсен', avatarUrl: null, locale: 'ru', units: 'metric' };
const ENTRY = {
  id: FLIGHT,
  status: 'ready',
  startedAt: '2023-07-23T06:00:00.000Z',
  uploadedAt: '2026-09-26T10:00:00.000Z',
  durationS: 17_640,
  distanceTrackM: 162_100,
  maxAltM: 3293,
  thermalCount: 28,
  takeoffSite: { id: '33333333-2222-4333-8444-555555555555', name: 'Ush Konyr', countryCode: 'kz', source: 'seed' },
};
const MAP = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: FLIGHT, startedAt: ENTRY.startedAt },
      geometry: { type: 'LineString', coordinates: [[76.9, 43.2], [77.1, 43.25], [77.3, 43.22]] },
    },
  ],
};

async function signedIn(page: Page): Promise<string[]> {
  const claimed: string[] = [];
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.route('**/api/v1/tiles/**', (route) => route.abort());
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: ME }));
  await page.route('**/api/v1/auth/providers', (route) => route.fulfill({ json: { google: true } }));
  await page.route('**/api/v1/imagery', (route) => route.fulfill({ json: { esri: true } }));
  await page.route('**/api/v1/logbook/map', (route) => route.fulfill({ json: MAP }));
  await page.route('**/api/v1/logbook/sites', (route) =>
    route.fulfill({ json: { sites: [{ ...ENTRY.takeoffSite, flightCount: 1 }] } }),
  );
  await page.route('**/api/v1/logbook', (route) => route.fulfill({ json: { items: [ENTRY], nextCursor: null } }));
  await page.route('**/api/v1/flights/claim', async (route) => {
    const body = route.request().postDataJSON() as { claims: { flightId: string }[] };
    claimed.push(...body.claims.map((c) => c.flightId));
    await route.fulfill({ json: { claimed: body.claims.map((c) => c.flightId) } });
  });
  return claimed;
}

for (const viewport of [
  { name: 'телефон', width: 390, height: 844 },
  { name: 'десктоп', width: 1440, height: 900 },
]) {
  test(`${viewport.name}: карта и список, страница не шире экрана`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signedIn(page);
    await page.goto('/#/logbook');

    await expect(page.locator('[data-panel="logbook-list"] tbody tr')).toHaveCount(1);
    // Место старта — под датой; фильтр по местам — над списком (задача 2.13).
    await expect(page.locator('[data-panel="logbook-list"] tbody tr')).toContainText('Ush Konyr');
    await expect(page.locator('select option')).toHaveCount(2);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
    // Атрибуция Esri обязательна по лицензии (ТЗ §11.3).
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('Powered by Esri');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
  });
}

test('после входа браузер забирает анонимные загрузки и забывает токены', async ({ page }) => {
  const claimed = await signedIn(page);
  await page.addInitScript(
    ([flightId]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('skyline.claims', JSON.stringify([{ flightId, token: 'secret', savedAt: Date.now() }]));
        sessionStorage.setItem('seeded', '1');
      }
    },
    [ANONYMOUS],
  );
  await page.goto('/#/logbook');

  await expect.poll(() => claimed).toEqual([ANONYMOUS]);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('skyline.claims'))).toBe('[]');
});
