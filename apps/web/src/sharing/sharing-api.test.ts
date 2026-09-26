import { describe, expect, it } from 'vitest';

import { resolveShare, shareUrl, withShare } from './sharing-api';

const FLIGHT = '22222222-2222-4333-8444-555555555555';

describe('sharing-api', () => {
  it('ссылка для чата — хэш-маршрут /s/ с токеном', () => {
    expect(shareUrl('https://skyline.gateapp.kz', 'abc_-1')).toBe('https://skyline.gateapp.kz/s/abc_-1');
  });

  it('токен добавляется к запросам полёта; без токена адрес не меняется', () => {
    expect(withShare('/api/v1/flights/x/track', 'tok')).toBe('/api/v1/flights/x/track?share=tok');
    expect(withShare('/api/v1/logbook?limit=1', 'tok')).toBe('/api/v1/logbook?limit=1&share=tok');
    expect(withShare('/api/v1/flights/x', null)).toBe('/api/v1/flights/x');
  });

  it('ссылка → полёт; сброшенная или личный полёт — null', async () => {
    const ok: typeof fetch = () => Promise.resolve(new Response(JSON.stringify({ flightId: FLIGHT }), { status: 200 }));
    const gone: typeof fetch = () => Promise.resolve(new Response('{}', { status: 404 }));
    expect(await resolveShare('good', ok)).toBe(FLIGHT);
    expect(await resolveShare('bad', gone)).toBeNull();
  });
});
