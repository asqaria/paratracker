import { describe, expect, it } from 'vitest';

import { fetchProfile, saveProfile } from './profile-api';

const ME = {
  id: '11111111-2222-4333-8444-555555555555',
  username: 'asqar',
  displayName: 'Асқар',
  avatarUrl: null,
  locale: 'ru',
  units: 'metric',
  defaultPrivacy: 'public',
};

const respond = (status: number, body: unknown = {}): typeof fetch => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('profile-api', () => {
  it('нет пилота — null, а не ошибка', async () => {
    expect(await fetchProfile('nobody', respond(404))).toBeNull();
  });

  it('сохранение: ответ — новый профиль; 409 — адрес занят; 400 — адрес не по правилам', async () => {
    expect(await saveProfile({ username: 'asqar' }, respond(200, ME))).toEqual({ kind: 'ok', me: ME });
    expect(await saveProfile({ username: 'taken' }, respond(409))).toEqual({ kind: 'taken' });
    expect(await saveProfile({ username: 'x' }, respond(400))).toEqual({ kind: 'invalid' });
    await expect(saveProfile({ displayName: 'x' }, respond(500))).rejects.toThrow();
  });
});
