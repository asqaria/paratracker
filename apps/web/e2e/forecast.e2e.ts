import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

/**
 * Прогноз на карте (задача П.3, ТЗ §6.9). Ответы API — реальный прогноз по
 * Уш-Коныру с прода (29.09.2026); время страницы зафиксировано на 30.09
 * 09:00 по Алматы, внешняя сеть закрыта — проверяется вёрстка и логика.
 */

const MAP = readFileSync(new URL('./forecast-map.json', import.meta.url), 'utf8');
const USH = readFileSync(new URL('./forecast-ush-konyr.json', import.meta.url), 'utf8');
/** 30.09.2026 09:00 по Алматы (UTC+5). */
const NOW = new Date(Date.UTC(2026, 8, 30, 4));

const VIEWPORTS = [
  { name: 'десктоп', width: 1280, height: 800, compact: false },
  { name: 'телефон', width: 390, height: 844, compact: true },
] as const;

async function openMap(page: Page, hash = '#/map'): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: { status: 404 } }));
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 401, json: { status: 401 } }));
  await page.route('**/api/v1/forecast', (route) => route.fulfill({ body: MAP, contentType: 'application/json' }));
  await page.route('**/api/v1/forecast/ush-konyr', (route) => route.fulfill({ body: USH, contentType: 'application/json' }));
  await page.goto(`/${hash}`);
  await expect(page.locator('[data-forecast="day-summary"]')).toBeVisible({ timeout: 30_000 });
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.compact });

    test('место на карте, панель по часам с 08 до 20, атрибуция и оговорка', async ({ page }) => {
      await openMap(page);
      await expect(page.locator('[data-site="ush-konyr"]')).toBeVisible();
      const panel = page.locator('[data-panel="forecast-site"]');
      await expect(panel.getByRole('heading', { name: 'Ush Konyr' })).toBeVisible();
      // Сегодня (30.09) — светлые часы 09…20: 08:00 уже прошло.
      const hours = panel.locator('thead button');
      await expect(hours.first()).toContainText('09');
      await expect(hours.last()).toContainText('20');
      await expect(page.locator('[data-panel="forecast-attribution"]')).toContainText('Open-Meteo');
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width).toBeLessThanOrEqual(viewport.width);
    });

    test('выбор часа — подробности: три модели и ветер по высотам', async ({ page }) => {
      await openMap(page, '#/map?site=ush-konyr');
      await page.locator('[data-panel="forecast-site"] thead button').filter({ hasText: '13' }).click();
      const hour = page.locator('[data-forecast="hour"]');
      await expect(hour).toBeVisible();
      for (const model of ['ECMWF', 'GFS', 'ICON']) await expect(hour).toContainText(model);
      await expect(hour.getByText(/Ветер по высотам|Wind aloft/)).toBeVisible();
    });

    test('другой день — часы с 08', async ({ page }) => {
      await openMap(page);
      await page.locator('[data-panel="forecast-time"] [role="tab"]').nth(1).click();
      await expect(page.locator('[data-panel="forecast-site"] thead button').first()).toContainText('08');
    });
  });
}
