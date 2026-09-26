import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

/**
 * Встраиваемый просмотрщик (задача 3.9): /embed/{токен} в iframe чужого сайта.
 * Облегчённый — сцена, таймлайн, сводка, атрибуция и выход «Открыть в Skyline»;
 * аналитики, настроек владельца и баннера сохранения нет. API подменён:
 * ссылка ведёт на демо-трек, внешняя сеть закрыта — проверяется вёрстка.
 */

const TOKEN = 'embedToken_12';
const FLIGHT_ID = '22222222-2222-4333-8444-555555555555';
const DEMO_TRACK = readFileSync(new URL('../public/demo/baseline.track', import.meta.url));

const VIEWPORTS = [
  { name: 'iframe 800×600', width: 800, height: 600, compact: false },
  { name: 'iframe на телефоне', width: 360, height: 480, compact: true },
] as const;

async function openEmbed(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  // Сначала — «всё остальное API не найдено», конкретные ответы ниже важнее (Playwright берёт последний).
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: { status: 404 } }));
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 401, json: { status: 401 } }));
  await page.route('**/api/v1/imagery', (route) => route.fulfill({ json: { esri: true } }));
  await page.route(`**/api/v1/share/${TOKEN}`, (route) => route.fulfill({ json: { flightId: FLIGHT_ID } }));
  await page.route(`**/api/v1/flights/${FLIGHT_ID}/track?share=${TOKEN}`, (route) =>
    route.fulfill({ body: DEMO_TRACK, contentType: 'application/octet-stream' }),
  );
  await page.goto(`/embed/${TOKEN}`);
  await expect(page.locator('[data-panel="timeline"]')).toBeVisible({ timeout: 30_000 });
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.compact });

    test('облегчённый: выход в Skyline есть, аналитики и баннера нет, атрибуция на месте', async ({ page }) => {
      await openEmbed(page);
      const open = page.locator('[data-panel="open-in-app"]');
      await expect(open).toBeVisible();
      await expect(open).toHaveAttribute('href', `/#/s/${TOKEN}`);
      await expect(open).toHaveAttribute('target', '_blank');
      await expect(page.locator('[data-panel="attribution"]')).toBeVisible();
      await expect(page.locator('[data-panel="analytics"]')).toHaveCount(0);
      await expect(page.locator('[data-panel="save-banner"]')).toHaveCount(0);
    });

    test('выход в Skyline на экране и не наезжает на соседей', async ({ page }) => {
      await openEmbed(page);
      const open = await page.locator('[data-panel="open-in-app"]').boundingBox();
      expect(open).not.toBeNull();
      if (!open) return;
      expect(open.x + open.width).toBeLessThanOrEqual(viewport.width + 1);
      const neighbours = viewport.compact ? ['sheet', 'timeline'] : ['summary', 'imagery', 'timeline'];
      for (const name of neighbours) {
        const box = await page.locator(`[data-panel="${name}"]:visible`).boundingBox();
        if (!box) continue;
        const overlap =
          open.x + open.width - 1 > box.x && box.x + box.width - 1 > open.x && open.y + open.height - 1 > box.y && box.y + box.height - 1 > open.y;
        expect(overlap, `наезжает на ${name}`).toBe(false);
      }
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
    });
  });
}

test('сброшенная ссылка — сообщение, а не пустой iframe', async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: { status: 404 } }));
  await page.goto(`/embed/${TOKEN}`);
  await expect(page.getByRole('alert')).toBeVisible();
});
