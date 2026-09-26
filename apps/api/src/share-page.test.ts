import type { SharePreviewRecord } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { pageLocale, shareCard } from './share-page.js';

const FLIGHT_ID = '22222222-2222-4333-8444-555555555555';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

const flight = (patch: Partial<SharePreviewRecord> = {}): SharePreviewRecord => ({
  flightId: FLIGHT_ID,
  previewObjectKey: `previews/${FLIGHT_ID}.jpg`,
  siteName: 'Кок-Жайляу',
  // 07:30 UTC = 12:30 в Алматы, та же дата.
  startedAt: new Date(Date.UTC(2026, 8, 26, 7, 30)),
  timezone: 'Asia/Almaty',
  airtimeS: 3 * 3600 + 12 * 60,
  distanceTrackM: 61_234,
  maxAltM: 3250,
  xcDistanceM: 45_210,
  xcScore: 63.29,
  ...patch,
});

function harness(found: SharePreviewRecord | null = flight()) {
  const reads: string[] = [];
  const app = buildApp({
    logger: false,
    sharePage: {
      find: (token) => Promise.resolve(token === 'good' ? found : null),
      storage: {
        get: (key) => {
          reads.push(key);
          return Promise.resolve(JPEG);
        },
      },
      publicUrl: 'https://skyline.example',
    },
  });
  return { app, reads };
}

describe('shareCard — подпись карточки', () => {
  it('место и местная дата; время в воздухе, XC, высота', () => {
    expect(shareCard(flight(), 'ru')).toEqual({
      title: 'Кок-Жайляу · 26 сентября 2026 г.',
      description: '3 ч 12 мин в воздухе · XC 45,2 км, 63,3 очк. · макс. 3 250 м',
    });
    expect(shareCard(flight(), 'en').description).toBe('3 h 12 min airtime · XC 45.2 km, 63.3 pts · max 3,250 m');
  });

  it('без места и XC — «Полёт» и дистанция по треку; дата — по таймзоне взлёта', () => {
    const card = shareCard(
      flight({ siteName: null, xcDistanceM: null, xcScore: null, startedAt: new Date(Date.UTC(2026, 8, 26, 20)) }),
      'ru',
    );
    // 20:00 UTC = 01:00 следующего дня в Алматы.
    expect(card.title).toBe('Полёт · 27 сентября 2026 г.');
    expect(card.description).toContain('61,2 км по треку');
  });

  it('язык — английский только по просьбе', () => {
    expect(pageLocale('en-US,en;q=0.9')).toBe('en');
    expect(pageLocale('ru-RU')).toBe('ru');
    expect(pageLocale(undefined)).toBe('ru');
  });
});

describe('GET /s/:token', () => {
  it('Open Graph с абсолютной картинкой и переадресация человека в просмотрщик', async () => {
    const response = await harness().app.inject({ method: 'GET', url: '/s/good' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    const html = response.body;
    expect(html).toContain('<meta property="og:title" content="Кок-Жайляу · 26 сентября 2026 г.">');
    expect(html).toContain('<meta property="og:image" content="https://skyline.example/api/v1/share/good/preview.jpg">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<meta property="og:url" content="https://skyline.example/s/good">');
    expect(html).toContain('location.replace("/#/s/good")');
  });

  it('превью ещё нет — карточка без картинки', async () => {
    const html = (await harness(flight({ previewObjectKey: null })).app.inject({ method: 'GET', url: '/s/good' })).body;
    expect(html).not.toContain('og:image');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it('неизвестная или личная ссылка — 404, но человек всё равно попадает в приложение', async () => {
    const response = await harness().app.inject({ method: 'GET', url: '/s/bad' });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('Ссылка не найдена');
    expect(response.body).toContain('location.replace("/#/s/bad")');
  });

  it('текст из базы экранируется', async () => {
    const html = (await harness(flight({ siteName: '<script>"x"</script>' })).app.inject({ method: 'GET', url: '/s/good' }))
      .body;
    expect(html).not.toContain('<script>"x"');
    expect(html).toContain('&lt;script&gt;&quot;x&quot;');
  });
});

describe('GET /api/v1/share/:token/preview.jpg', () => {
  it('JPEG из хранилища по ключу полёта', async () => {
    const h = harness();
    const response = await h.app.inject({ method: 'GET', url: '/api/v1/share/good/preview.jpg' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.rawPayload).toEqual(Buffer.from(JPEG));
    expect(h.reads).toEqual([`previews/${FLIGHT_ID}.jpg`]);
  });

  it('нет ссылки или превью — 404 problem+json', async () => {
    for (const [found, url] of [
      [flight(), '/api/v1/share/bad/preview.jpg'],
      [flight({ previewObjectKey: null }), '/api/v1/share/good/preview.jpg'],
    ] as const) {
      const response = await harness(found).app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
    }
  });
});
