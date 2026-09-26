import { describe, expect, it } from 'vitest';

import { AuthProvidersResponse, MeResponse, safeReturnTo } from './auth-dto.js';

describe('MeResponse', () => {
  const me = {
    id: '11111111-2222-4333-8444-555555555555',
    username: 'asqar',
    displayName: 'Асқар',
    avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
    locale: 'ru',
    units: 'metric',
  };

  it('принимает профиль текущего пользователя', () => {
    expect(MeResponse.parse(me)).toEqual(me);
  });

  it('не выпускает наружу лишние поля строки БД', () => {
    expect(MeResponse.parse({ ...me, email: 'a@b.kz', passwordHash: 'x' })).toEqual(me);
  });

  it('имя и аватар могут отсутствовать', () => {
    expect(MeResponse.safeParse({ ...me, displayName: null, avatarUrl: null }).success).toBe(true);
  });
});

describe('AuthProvidersResponse', () => {
  it('сообщает, какие провайдеры входа настроены', () => {
    expect(AuthProvidersResponse.parse({ google: false })).toEqual({ google: false });
  });
});

describe('safeReturnTo', () => {
  it('пропускает хэш-маршрут приложения', () => {
    expect(safeReturnTo('#/flight/11111111-2222-4333-8444-555555555555')).toBe(
      '#/flight/11111111-2222-4333-8444-555555555555',
    );
  });

  it('открытый редирект на чужой сайт заменяет на главную', () => {
    for (const value of ['https://evil.example', '//evil.example', '/\evil.example', 'javascript:alert(1)', '#/x y']) {
      expect(safeReturnTo(value)).toBe('#/');
    }
  });

  it('без значения — главная', () => {
    expect(safeReturnTo(undefined)).toBe('#/');
  });
});
