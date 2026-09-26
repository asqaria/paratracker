import { describe, expect, it } from 'vitest';

import { fetchMe, fetchProviders, logout, ME_URL, PROVIDERS_URL, REFRESH_URL, LOGOUT_URL, signInUrl } from './session';

const ME = {
  id: '11111111-2222-4333-8444-555555555555',
  username: 'asqar',
  displayName: 'Асқар',
  avatarUrl: null,
  locale: 'ru',
  units: 'metric',
};

const problem = (status: number) =>
  new Response(JSON.stringify({ type: 'about:blank', title: 'x', status }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const noContent = () => new Response(null, { status: 204 });

/** Отвечает по очереди и записывает, куда ходили. */
function scripted(answers: Response[]) {
  const calls: { url: string; method: string }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push({ url: input as string, method: init?.method ?? 'GET' });
    const next = answers.shift();
    return next ? Promise.resolve(next) : Promise.reject(new Error('unexpected request'));
  };
  return { calls, fetchImpl };
}

describe('fetchMe', () => {
  it('вошёл — профиль', async () => {
    const { calls, fetchImpl } = scripted([json(ME)]);
    expect(await fetchMe(fetchImpl)).toEqual(ME);
    expect(calls).toEqual([{ url: ME_URL, method: 'GET' }]);
  });

  it('access истёк — обновляет сессию и спрашивает снова', async () => {
    const { calls, fetchImpl } = scripted([problem(401), noContent(), json(ME)]);
    expect(await fetchMe(fetchImpl)).toEqual(ME);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${ME_URL}`, `POST ${REFRESH_URL}`, `GET ${ME_URL}`]);
  });

  it('соседняя вкладка уже обновила (409) — просто спрашивает снова', async () => {
    const { calls, fetchImpl } = scripted([problem(401), problem(409), json(ME)]);
    expect(await fetchMe(fetchImpl)).toEqual(ME);
    expect(calls).toHaveLength(3);
  });

  it('сессии нет — null, без бесконечных повторов', async () => {
    const { calls, fetchImpl } = scripted([problem(401), problem(401)]);
    expect(await fetchMe(fetchImpl)).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('вход на сервере выключен (404 маршрута) — null', async () => {
    const { fetchImpl } = scripted([problem(404)]);
    expect(await fetchMe(fetchImpl)).toBeNull();
  });

  it('сервер упал — исключение, а не «не вошёл»', async () => {
    const { fetchImpl } = scripted([problem(502)]);
    await expect(fetchMe(fetchImpl)).rejects.toThrow(/502/);
  });
});

describe('fetchProviders', () => {
  it('читает список провайдеров', async () => {
    const { calls, fetchImpl } = scripted([json({ google: true })]);
    expect(await fetchProviders(fetchImpl)).toEqual({ google: true });
    expect(calls[0]?.url).toBe(PROVIDERS_URL);
  });

  it('вход выключен (404) — ни одного провайдера', async () => {
    const { fetchImpl } = scripted([problem(404)]);
    expect(await fetchProviders(fetchImpl)).toEqual({ google: false });
  });
});

describe('logout', () => {
  it('POST на выход', async () => {
    const { calls, fetchImpl } = scripted([noContent()]);
    await logout(fetchImpl);
    expect(calls).toEqual([{ url: LOGOUT_URL, method: 'POST' }]);
  });
});

describe('signInUrl', () => {
  it('передаёт текущий маршрут для возврата', () => {
    expect(signInUrl('#/flight/abc')).toBe('/api/v1/auth/oauth/google?returnTo=%23%2Fflight%2Fabc');
  });

  it('с пустого хэша — на главную', () => {
    expect(signInUrl('')).toBe('/api/v1/auth/oauth/google?returnTo=%23%2F');
  });
});
