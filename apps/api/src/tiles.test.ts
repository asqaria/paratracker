import { ImageryCapabilities, PROBLEM_CONTENT_TYPE } from '@skyline/core';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from './app.js';
import type { TileRoutesDeps } from './tiles.js';

const TEMPLATE = 'https://ibasemaps-api.example/tile/{z}/{y}/{x}';
const TILE_BYTES = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0);

const appWith = (deps: Partial<TileRoutesDeps>) =>
  buildApp({
    logger: false,
    tiles: { tileUrlTemplate: TEMPLATE, apiKey: 'secret-key', ...deps },
  });

describe('GET /api/v1/tiles/esri/:z/:y/:x', () => {
  it('подставляет ключ на сервере и отдаёт тайл', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(TILE_BYTES, { status: 200, headers: { 'content-type': 'image/jpeg' } })),
    );

    const response = await appWith({ fetchImpl }).inject({ method: 'GET', url: '/api/v1/tiles/esri/12/345/678' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(new Uint8Array(response.rawPayload)).toEqual(TILE_BYTES);
    // Кэширование тайлов Esri ограничено лицензией.
    expect(response.headers['cache-control']).toBe('no-store');

    const requested = fetchImpl.mock.calls[0]?.[0];
    const requestedUrl = requested instanceof URL ? requested.href : requested instanceof Request ? requested.url : requested;
    expect(requestedUrl).toBe('https://ibasemaps-api.example/tile/12/345/678?token=secret-key');
  });

  it('ключ не настроен — 503, а не попытка запроса без токена', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const response = await appWith({ apiKey: null, fetchImpl }).inject({
      method: 'GET',
      url: '/api/v1/tiles/esri/12/345/678',
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['/api/v1/tiles/esri/99/1/1', '/api/v1/tiles/esri/12/-1/1', '/api/v1/tiles/esri/12/a/1'])(
    'битые координаты — 400: %s',
    async (url) => {
      const fetchImpl = vi.fn<typeof fetch>();
      const response = await appWith({ fetchImpl }).inject({ method: 'GET', url });

      expect(response.statusCode).toBe(400);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('провайдер недоступен или ответил ошибкой — 502', async () => {
    const failing = appWith({ fetchImpl: vi.fn<typeof fetch>(() => Promise.reject(new Error('ECONNRESET'))) });
    const rejecting = appWith({
      fetchImpl: vi.fn<typeof fetch>(() => Promise.resolve(new Response('nope', { status: 403 }))),
    });

    for (const app of [failing, rejecting]) {
      const response = await app.inject({ method: 'GET', url: '/api/v1/tiles/esri/12/345/678' });
      expect(response.statusCode).toBe(502);
      expect(response.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    }
  });
});

describe('GET /api/v1/imagery', () => {
  it('ключ и адрес Esri настроены — esri: true', async () => {
    const response = await appWith({}).inject({ method: 'GET', url: '/api/v1/imagery' });

    expect(response.statusCode).toBe(200);
    expect(ImageryCapabilities.parse(response.json())).toEqual({ esri: true });
    // Настройка меняется только перезапуском API — минута кэша безопасна.
    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });

  it.each([
    ['нет ключа', { apiKey: null }],
    ['нет адреса', { tileUrlTemplate: null }],
  ])('%s — esri: false, кнопки Esri быть не должно', async (_, deps) => {
    const response = await appWith(deps).inject({ method: 'GET', url: '/api/v1/imagery' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ esri: false });
  });

  it('ключ наружу не уходит', async () => {
    const response = await appWith({}).inject({ method: 'GET', url: '/api/v1/imagery' });
    expect(response.body).not.toContain('secret-key');
  });
});
