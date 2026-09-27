import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

/**
 * Картинка для сторис (задача 4.8): в просмотрщике «Для сторис» рисует два
 * PNG 1080×1920 — со спутником и прозрачный. API подменён, внешняя сеть
 * закрыта: тайлы не приходят, проверяется сборка картинок и окно.
 */

const TOKEN = 'storyToken_1';
const FLIGHT_ID = '33333333-3333-4333-8444-555555555555';
const DEMO_TRACK = readFileSync(new URL('../public/demo/baseline.track', import.meta.url));

async function openShared(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: { status: 404 } }));
  await page.route('**/api/v1/me', (route) => route.fulfill({ status: 401, json: { status: 401 } }));
  await page.route('**/api/v1/imagery', (route) => route.fulfill({ json: { esri: true } }));
  await page.route(`**/api/v1/share/${TOKEN}`, (route) => route.fulfill({ json: { flightId: FLIGHT_ID } }));
  await page.route(`**/api/v1/flights/${FLIGHT_ID}/track?share=${TOKEN}`, (route) =>
    route.fulfill({ body: DEMO_TRACK, contentType: 'application/octet-stream' }),
  );
  await page.goto(`/#/s/${TOKEN}`);
  await expect(page.locator('[data-panel="timeline"]')).toBeVisible({ timeout: 30_000 });
}

test.use({ viewport: { width: 1280, height: 800 } });

test('два варианта 1080×1920: у прозрачного — прозрачный угол; окно закрывается', async ({ page }) => {
  await openShared(page);
  await page.locator('[data-panel="story-open"]').click();
  const dialog = page.locator('[data-panel="story"]');
  await expect(dialog).toBeVisible();
  for (const variant of ['full', 'overlay']) {
    const img = dialog.locator(`[data-story="${variant}"] img`);
    await expect(img).toBeVisible({ timeout: 30_000 });
    await expect(dialog.locator(`[data-story="${variant}"] a[download]`)).toHaveAttribute('download', `skyline-${variant}.png`);
  }
  const probe = await page.evaluate(async () => {
    const read = async (variant: string) => {
      const img = document.querySelector<HTMLImageElement>(`[data-story="${variant}"] img`);
      if (!img) return null;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0);
      return { w: img.naturalWidth, h: img.naturalHeight, cornerAlpha: ctx?.getImageData(5, 5, 1, 1).data[3] ?? -1 };
    };
    return { full: await read('full'), overlay: await read('overlay') };
  });
  expect(probe.full).toEqual({ w: 1080, h: 1920, cornerAlpha: 255 });
  expect(probe.overlay).toEqual({ w: 1080, h: 1920, cornerAlpha: 0 });
  await dialog.getByRole('button', { name: /Закрыть|Close/ }).click();
  await expect(dialog).toHaveCount(0);
});
