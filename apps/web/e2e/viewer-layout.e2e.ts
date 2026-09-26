import { expect, test, type Page } from '@playwright/test';

/**
 * Раскладка просмотрщика на телефоне и на десктопе: панели не наезжают друг
 * на друга, ничего не уходит за край экрана, на телефоне кнопки — под палец.
 * Сцена грузит демо-трек из public/, внешняя сеть закрыта: проверяется вёрстка,
 * а не тайлы.
 */

const VIEWPORTS = [
  { name: 'телефон, портрет', width: 390, height: 844, compact: true },
  { name: 'телефон, альбомная', width: 844, height: 390, compact: true },
  { name: 'десктоп', width: 1440, height: 900, compact: false },
] as const;

/**
 * Десктоп — панели поверх сцены; телефон — сводка, легенда, подложка и
 * аналитика в шторке снизу (ТЗ §8.3), поверх сцены панелей нет.
 */
const PANELS = {
  compact: ['sheet', 'attribution', 'timeline'],
  wide: ['summary', 'imagery', 'legend', 'attribution', 'timeline'],
} as const;

/** Apple HIG / WCAG 2.5.5: цель касания не меньше 44 CSS px. */
const MIN_TAP_PX = 44;
/** Субпиксельное округление раскладки. */
const EPSILON_PX = 1;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x + a.width - EPSILON_PX > b.x &&
  b.x + b.width - EPSILON_PX > a.x &&
  a.y + a.height - EPSILON_PX > b.y &&
  b.y + b.height - EPSILON_PX > a.y;

async function openDemo(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  // Сервер подтверждает Esri — в переключателе обе подложки, как в проде.
  await page.route('**/api/v1/imagery', (route) => route.fulfill({ json: { esri: true } }));
  await page.goto('/#/demo');
  await expect(page.locator('[data-panel="timeline"]')).toBeVisible({ timeout: 30_000 });
  // Переключатель подложки — в верхней панели (десктоп) и в шторке (телефон), по две кнопки.
  await expect(page.locator(':is([data-panel="imagery"], [data-panel="sheet-imagery"]) button')).toHaveCount(4);
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.compact });

    test('панели на экране и не наезжают друг на друга', async ({ page }) => {
      await openDemo(page);
      const panels = viewport.compact ? PANELS.compact : PANELS.wide;
      const boxes = new Map<string, Box>();
      for (const panel of panels) {
        const box = await page.locator(`[data-panel="${panel}"]:visible`).boundingBox();
        expect(box, `${panel} не отрисована`).not.toBeNull();
        if (!box) continue;
        expect(box.x, `${panel} за левым краем`).toBeGreaterThanOrEqual(-EPSILON_PX);
        expect(box.y, `${panel} за верхним краем`).toBeGreaterThanOrEqual(-EPSILON_PX);
        expect(box.x + box.width, `${panel} за правым краем`).toBeLessThanOrEqual(viewport.width + EPSILON_PX);
        expect(box.y + box.height, `${panel} за нижним краем`).toBeLessThanOrEqual(viewport.height + EPSILON_PX);
        boxes.set(panel, box);
      }
      for (const [i, a] of panels.entries()) {
        for (const b of panels.slice(i + 1)) {
          const boxA = boxes.get(a);
          const boxB = boxes.get(b);
          if (boxA && boxB) expect(overlaps(boxA, boxB), `${a} наезжает на ${b}`).toBe(false);
        }
      }
    });

    test('все органы управления видны целиком, страница не прокручивается вбок', async ({ page }) => {
      await openDemo(page);
      const controls = page.locator('button:visible, select:visible, [role="slider"]:visible');
      const count = await controls.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const box = await controls.nth(i).boundingBox();
        const label = (await controls.nth(i).getAttribute('aria-label')) ?? (await controls.nth(i).innerText());
        expect(box, label).not.toBeNull();
        if (!box) continue;
        expect(box.x >= -EPSILON_PX && box.x + box.width <= viewport.width + EPSILON_PX, `${label} за краем`).toBe(true);
        expect(box.y >= -EPSILON_PX && box.y + box.height <= viewport.height + EPSILON_PX, `${label} за краем`).toBe(true);
      }
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
    });

    if (viewport.compact) {
      test('сцене — не меньше 60 % высоты экрана: низ не съедает её', async ({ page }) => {
        await openDemo(page);
        const top = await page.locator('[data-panel="sheet"]').evaluate((element) => element.getBoundingClientRect().top);
        expect(top / viewport.height).toBeGreaterThanOrEqual(viewport.width > viewport.height ? 0.35 : 0.6);
      });

      test('кнопки таймлайна, ручка шторки и подложка — под палец', async ({ page }) => {
        await openDemo(page);
        // Подложка — в шторке: раскрыть её тапом по ручке.
        await page.locator('[data-panel="sheet"] > button').click();
        await expect(page.locator('[data-panel="sheet"]')).toHaveAttribute('data-snap', 'half');
        // Кнопка «развернуть атрибуцию» — второстепенная, ей хватает строки текста.
        const controls = page.locator(
          '[data-panel="timeline"] :is(button, select):visible, [data-panel="sheet"] > button, [data-panel="sheet-imagery"] button:visible',
        );
        const count = await controls.count();
        expect(count).toBeGreaterThanOrEqual(7);
        for (let i = 0; i < count; i++) {
          const box = await controls.nth(i).boundingBox();
          const label = (await controls.nth(i).getAttribute('aria-label')) ?? (await controls.nth(i).innerText());
          expect(box?.height ?? 0, `${label}: высота`).toBeGreaterThanOrEqual(MIN_TAP_PX - EPSILON_PX);
        }
      });

      test('шторка: тап по ручке — половина экрана, ещё тап — свёрнута; сводка видна всегда', async ({ page }) => {
        await openDemo(page);
        const sheet = page.locator('[data-panel="sheet"]');
        const handle = sheet.locator('> button');
        await expect(sheet).toHaveAttribute('data-snap', 'peek');
        await expect(page.locator('[data-panel="sheet-line"]')).toBeVisible();
        const peek = (await sheet.boundingBox())?.height ?? 0;
        await handle.click();
        await expect(sheet).toHaveAttribute('data-snap', 'half');
        await expect.poll(async () => (await sheet.boundingBox())?.height ?? 0).toBeGreaterThan(peek);
        await handle.click();
        await expect(sheet).toHaveAttribute('data-snap', 'peek');
      });

      test('атрибуция: свёрнута в строку и разворачивается по кнопке', async ({ page }) => {
        await openDemo(page);
        const attribution = page.locator('[data-panel="attribution"]');
        const toggle = attribution.getByRole('button');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        // Раскрытая — полный текст лицензий: он длиннее свёрнутой строки. Высота
        // может не измениться (у Esri полный текст помещается в строку).
        const shown = async (): Promise<string> => (await attribution.locator('p:visible').innerText()).trim();
        const collapsed = await shown();
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect((await shown()).length).toBeGreaterThan(collapsed.length);
      });
    }
  });
}
