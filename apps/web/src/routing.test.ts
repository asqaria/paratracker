import { describe, expect, it } from 'vitest';

import { flightHash, HEALTH_HASH, routeFromHash, trackUrlFromHash } from './routing';

describe('trackUrlFromHash', () => {
  it('полёт по id — .track из API', () => {
    expect(trackUrlFromHash('#/flight/11111111-2222-4333-8444-555555555555')).toBe(
      '/api/v1/flights/11111111-2222-4333-8444-555555555555/track',
    );
  });

  it('демо-трек', () => {
    expect(trackUrlFromHash('#/demo')).toBe('/demo/baseline.track');
  });

  it.each(['', '#/', '#/flight/', '#/flight/not-a-uuid', '#/other'])('лендинг для %j', (hash) => {
    expect(trackUrlFromHash(hash)).toBeNull();
  });
});

describe('routeFromHash', () => {
  it('пустой хэш и мусор — лендинг с дропзоной', () => {
    for (const hash of ['', '#/', '#/other']) {
      expect(routeFromHash(hash), hash).toEqual({ kind: 'landing' });
    }
  });

  it('состояние сервисов — отдельный маршрут', () => {
    expect(routeFromHash(HEALTH_HASH)).toEqual({ kind: 'health' });
  });

  it('полёт и демо ведут в просмотрщик', () => {
    expect(routeFromHash(flightHash('11111111-2222-4333-8444-555555555555'))).toEqual({
      kind: 'flight',
      trackUrl: '/api/v1/flights/11111111-2222-4333-8444-555555555555/track',
    });
    expect(routeFromHash('#/demo')).toEqual({ kind: 'flight', trackUrl: '/demo/baseline.track' });
  });
});

describe('flightHash', () => {
  it('даёт хэш, который routeFromHash понимает — редирект после загрузки', () => {
    const hash = flightHash('11111111-2222-4333-8444-555555555555');
    expect(hash).toBe('#/flight/11111111-2222-4333-8444-555555555555');
    expect(routeFromHash(hash).kind).toBe('flight');
  });
});
