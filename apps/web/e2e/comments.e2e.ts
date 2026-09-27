import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

/**
 * Комментарии к полёту в просмотрщике (задача 3.10б). API подменён: полёт —
 * демо-трек (старт записи 15.07.2026 09:00 UTC, fixtures/baseline.igc).
 * Проверяются список с ответом, перемотка по моменту, отправка с моментом.
 */

const FLIGHT = '22222222-2222-4333-8444-555555555555';
const ROOT = '77777777-2222-4333-8444-555555555555';
const STARTED_AT = '2026-07-15T09:00:00.000Z';
const DEMO_TRACK = readFileSync(new URL('../public/demo/baseline.track', import.meta.url));
const ME = {
  id: '11111111-2222-4333-8444-555555555555',
  username: 'coach',
  displayName: 'Тренер',
  avatarUrl: null,
  locale: 'ru',
  units: 'metric',
  defaultPrivacy: 'unlisted',
};

const details = {
  flightId: FLIGHT,
  status: 'ready',
  analysisLevel: 'full',
  startedAt: STARTED_AT,
  endedAt: '2026-07-15T09:16:00.000Z',
  timezone: 'Asia/Almaty',
  durationS: 960,
  thermalCount: 0,
  avgClimbMs: null,
  avgGlideRatio: null,
  wind: null,
  takeoffSite: null,
  landingSite: null,
  xc: null,
  glider: null,
  gliderRaw: null,
  pilotName: 'Айгерим',
  pilotUsername: 'aigerim',
  likeCount: 0,
  likedByMe: false,
  canEdit: false,
  privacy: 'public',
};

const comment = (id: string, parentId: string | null, body: string, timecodeS: number | null) => ({
  id,
  parentId,
  author: { username: 'coach', displayName: 'Тренер', avatarUrl: null },
  body,
  timecodeS,
  createdAt: '2026-07-16T10:00:00.000Z',
  canDelete: true,
});

async function openFlight(page: Page): Promise<unknown[]> {
  const posted: unknown[] = [];
  const comments = [comment(ROOT, null, 'Здесь ушёл из термика', 300), comment('88888888-2222-4333-8444-555555555555', ROOT, 'А куда надо было?', null)];
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 404, json: { status: 404 } }));
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: ME }));
  await page.route('**/api/v1/imagery', (route) => route.fulfill({ json: { esri: false } }));
  await page.route(`**/api/v1/flights/${FLIGHT}`, (route) => route.fulfill({ json: details }));
  await page.route(`**/api/v1/flights/${FLIGHT}/track`, (route) =>
    route.fulfill({ body: DEMO_TRACK, contentType: 'application/octet-stream' }),
  );
  await page.route(`**/api/v1/flights/${FLIGHT}/thermals`, (route) => route.fulfill({ json: { thermals: [] } }));
  await page.route(`**/api/v1/flights/${FLIGHT}/glides`, (route) => route.fulfill({ json: { glides: [] } }));
  await page.route(`**/api/v1/flights/${FLIGHT}/wind`, (route) => route.fulfill({ json: { flight: null, profile: [] } }));
  await page.route(`**/api/v1/flights/${FLIGHT}/comments`, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { body: string; timecodeS?: number };
      posted.push(body);
      const created = comment('99999999-2222-4333-8444-555555555555', null, body.body, body.timecodeS ?? null);
      comments.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    return route.fulfill({ json: { comments } });
  });
  await page.goto(`/#/flight/${FLIGHT}`);
  await expect(page.locator('[data-panel="timeline"]')).toBeVisible({ timeout: 30_000 });
  // Панель аналитики может быть свёрнута — раскрыть, если так.
  const toggle = page.locator('[data-panel="analytics"] > button[aria-expanded]');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(page.locator('[data-panel="comments"]:visible')).toBeVisible();
  return posted;
}

test.use({ viewport: { width: 1440, height: 900 } });

test('комментарий и ответ; клик по моменту перематывает трек', async ({ page }) => {
  await openFlight(page);
  const section = page.locator('[data-panel="comments"]:visible');
  await expect(section.locator('[data-comment]')).toHaveCount(2);
  await expect(section).toContainText('Здесь ушёл из термика');
  await expect(section).toContainText('А куда надо было?');
  await section.locator('[data-timecode]').click();
  await expect(page.locator('[data-panel="timeline"]')).toContainText('00:05:00');
});

test('новый комментарий уходит с моментом проигрывания', async ({ page }) => {
  const posted = await openFlight(page);
  const section = page.locator('[data-panel="comments"]:visible');
  await section.locator('[data-timecode]').click();
  await section.getByRole('textbox', { name: /Комментарий к полёту|Comment on this flight/ }).fill('Красиво');
  await section.getByRole('button', { name: /Отправить|Send/ }).click();
  await expect(section.locator('[data-comment]')).toHaveCount(3);
  expect(posted).toEqual([{ body: 'Красиво', timecodeS: 300 }]);
});
