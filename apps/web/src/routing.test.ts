import { describe, expect, it } from 'vitest';

import {
  AUTH_FAILED_HASH,
  flightHash,
  HEALTH_HASH,
  LOGBOOK_HASH,
  routeFromHash,
  SETTINGS_HASH,
  trackUrlFromHash,
} from './routing';

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

  it('сверка термиков — тот же полёт в режиме сверки', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    expect(routeFromHash(`#/flight/${id}/review`)).toEqual({
      kind: 'flight',
      flightId: id,
      trackUrl: `/api/v1/flights/${id}/track`,
      review: true,
    });
  });

  it('неудачный вход — лендинг с сообщением', () => {
    expect(routeFromHash(AUTH_FAILED_HASH)).toEqual({ kind: 'landing', authFailed: true });
  });

  it('ссылка «по ссылке» — токен из хэша; мусор — лендинг', () => {
    expect(routeFromHash('#/s/Abc_-123456789')).toEqual({ kind: 'shared', token: 'Abc_-123456789' });
    expect(routeFromHash('#/s/x')).toEqual({ kind: 'landing' });
  });

  it('логбук и настройки — отдельные маршруты', () => {
    expect(routeFromHash(LOGBOOK_HASH)).toEqual({ kind: 'logbook' });
    expect(routeFromHash(SETTINGS_HASH)).toEqual({ kind: 'settings' });
  });

  it('состояние сервисов — отдельный маршрут', () => {
    expect(routeFromHash(HEALTH_HASH)).toEqual({ kind: 'health' });
  });

  it('полёт и демо ведут в просмотрщик; у демо нет id — аналитики из API нет', () => {
    expect(routeFromHash(flightHash('11111111-2222-4333-8444-555555555555'))).toEqual({
      kind: 'flight',
      flightId: '11111111-2222-4333-8444-555555555555',
      trackUrl: '/api/v1/flights/11111111-2222-4333-8444-555555555555/track',
    });
    expect(routeFromHash('#/demo')).toEqual({ kind: 'flight', flightId: null, trackUrl: '/demo/baseline.track' });
  });
});

describe('flightHash', () => {
  it('даёт хэш, который routeFromHash понимает — редирект после загрузки', () => {
    const hash = flightHash('11111111-2222-4333-8444-555555555555');
    expect(hash).toBe('#/flight/11111111-2222-4333-8444-555555555555');
    expect(routeFromHash(hash).kind).toBe('flight');
  });
});
