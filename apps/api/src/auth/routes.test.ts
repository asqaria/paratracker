import { MeResponse, PROBLEM_CONTENT_TYPE, UploadResponse } from '@skyline/core';
import type { NewSession, OAuthIdentity, RotateResult, UserProfile } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { AUTH } from '../constants.js';
import type { FlightRoutesDeps, NewFlightInput } from '../flights.js';
import { multipartBody } from '../testing/multipart.js';
import type { GoogleOAuth } from './google.js';
import type { AuthDeps } from './routes.js';
import { hashToken, signAccessToken } from './tokens.js';

const SECRET = new TextEncoder().encode('test-secret-that-is-at-least-32-bytes!');
const PUBLIC_URL = 'https://skyline.example';
const USER_ID = '11111111-2222-4333-8444-555555555555';
const FLIGHT_ID = '99999999-2222-4333-8444-555555555555';
const NOW = new Date(Date.UTC(2026, 8, 26, 12));
const REDIRECT_URI = `${PUBLIC_URL}/api/v1/auth/oauth/google/callback`;

const PROFILE: UserProfile = {
  id: USER_ID,
  username: 'asqar',
  displayName: 'Асқар',
  avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
  locale: 'ru',
  units: 'metric',
};

const IDENTITY: OAuthIdentity = {
  provider: 'google',
  subject: 'google-sub',
  email: 'pilot@gmail.com',
  displayName: 'Асқар',
  avatarUrl: null,
};

interface Harness {
  app: ReturnType<typeof buildApp>;
  signIns: OAuthIdentity[];
  sessions: NewSession[];
  rotations: string[];
  revoked: string[];
  exchanges: { code: string; codeVerifier: string; redirectUri: string; nonce: string }[];
  inserted: NewFlightInput[];
  setRotate(result: RotateResult): void;
  setExchangeFails(fails: boolean): void;
}

function harness(options: { google?: boolean } = {}): Harness {
  const h = {
    signIns: [] as OAuthIdentity[],
    sessions: [] as NewSession[],
    rotations: [] as string[],
    revoked: [] as string[],
    exchanges: [] as Harness['exchanges'],
    inserted: [] as NewFlightInput[],
  };
  let rotateResult: RotateResult = { kind: 'rotated', userId: USER_ID };
  let exchangeFails = false;

  const google: GoogleOAuth = {
    authorizeUrl: ({ state, codeChallenge, nonce, redirectUri }) =>
      `https://accounts.example/auth?${new URLSearchParams({ state, codeChallenge, nonce, redirectUri }).toString()}`,
    exchange: (params) => {
      h.exchanges.push(params);
      return exchangeFails ? Promise.reject(new Error('bad code')) : Promise.resolve(IDENTITY);
    },
  };

  const auth: AuthDeps = {
    jwtSecret: SECRET,
    publicUrl: PUBLIC_URL,
    google: options.google === false ? null : google,
    users: {
      signIn: (identity) => {
        h.signIns.push(identity);
        return Promise.resolve({ userId: USER_ID, created: true });
      },
      profile: (id) => Promise.resolve(id === USER_ID ? PROFILE : null),
    },
    sessions: {
      create: (session) => {
        h.sessions.push(session);
        return Promise.resolve();
      },
      rotate: ({ tokenHash }) => {
        h.rotations.push(tokenHash);
        return Promise.resolve(rotateResult);
      },
      revoke: (tokenHash) => {
        h.revoked.push(tokenHash);
        return Promise.resolve();
      },
    },
    now: () => NOW,
  };

  const flights: FlightRoutesDeps = {
    repository: {
      insert: (flight) => {
        h.inserted.push(flight);
        return Promise.resolve({
          id: flight.id,
          status: 'pending',
          sourceFormat: flight.sourceFormat,
          rawObjectKey: flight.rawObjectKey,
          trackObjectKey: null,
          errorCode: null,
          userId: flight.userId,
          privacy: 'unlisted',
          shareToken: null,
          publicTrackObjectKey: null,
          previewObjectKey: null,
        });
      },
      find: () => Promise.resolve(null),
    },
    storage: { put: () => Promise.resolve(), get: () => Promise.reject(new Error('unused')) },
    events: { subscribe: () => () => undefined },
    onQueued: () => Promise.resolve(),
    newFlightId: () => FLIGHT_ID,
  };

  return {
    app: buildApp({ logger: false, auth, flights }),
    ...h,
    setRotate: (result) => {
      rotateResult = result;
    },
    setExchangeFails: (fails) => {
      exchangeFails = fails;
    },
  };
}

type Cookie = { name: string; value: string; path?: string; httpOnly?: boolean; secure?: boolean; sameSite?: string; maxAge?: number };
const cookie = (res: { cookies: Cookie[] }, name: string): Cookie | undefined => res.cookies.find((c) => c.name === name);

/** Начать вход и вернуть то, что браузер понесёт в callback. */
async function startLogin(h: Harness, returnTo = '#/flight/abc') {
  const res = await h.app.inject({ method: 'GET', url: `/api/v1/auth/oauth/google?returnTo=${encodeURIComponent(returnTo)}` });
  const location = new URL(res.headers.location ?? '');
  const oauthCookie = cookie(res, 'skyline_oauth');
  return { res, state: location.searchParams.get('state') ?? '', location, oauthCookie };
}

describe('GET /auth/providers', () => {
  it('Google настроен — true, нет — false', async () => {
    expect((await harness().app.inject('/api/v1/auth/providers')).json()).toEqual({ google: true });
    expect((await harness({ google: false }).app.inject('/api/v1/auth/providers')).json()).toEqual({ google: false });
  });
});

describe('вход через Google', () => {
  it('старт: редирект к Google с state, PKCE и nonce; состояние — в подписанной httpOnly-cookie', async () => {
    const { res, location, oauthCookie } = await startLogin(harness());
    expect(res.statusCode).toBe(302);
    expect(location.origin).toBe('https://accounts.example');
    expect(location.searchParams.get('redirectUri')).toBe(REDIRECT_URI);
    expect(location.searchParams.get('state')).toMatch(/^[\w-]{43}$/);
    expect(location.searchParams.get('nonce')).toMatch(/^[\w-]{43}$/);
    expect(location.searchParams.get('codeChallenge')).toMatch(/^[\w-]{43}$/);
    expect(oauthCookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/api/v1/auth/oauth',
      maxAge: AUTH.oauthStateTtlS,
    });
  });

  it('Google не настроен — 503 Problem Details', async () => {
    const res = await harness({ google: false }).app.inject('/api/v1/auth/oauth/google');
    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  });

  it('callback: сессия создана, cookie выставлены, возврат туда, откуда пришёл', async () => {
    const h = harness();
    const { state, oauthCookie, location } = await startLogin(h);
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/google/callback?code=code-1&state=${state}`,
      cookies: { skyline_oauth: oauthCookie?.value ?? '' },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/#/flight/abc`);
    expect(h.exchanges).toEqual([
      expect.objectContaining({ code: 'code-1', redirectUri: REDIRECT_URI, nonce: location.searchParams.get('nonce') }),
    ]);
    expect(h.signIns).toEqual([IDENTITY]);

    const access = cookie(res, 'skyline_at');
    const refresh = cookie(res, 'skyline_rt');
    expect(access).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/api/v1', maxAge: AUTH.accessTokenTtlS });
    expect(refresh).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/api/v1/auth', maxAge: AUTH.refreshTokenTtlS });
    // В БД — только хэш refresh-токена.
    expect(h.sessions).toEqual([
      { userId: USER_ID, tokenHash: hashToken(refresh?.value ?? ''), expiresAt: new Date(NOW.getTime() + AUTH.refreshTokenTtlS * 1000) },
    ]);
    // Состояние входа одноразовое.
    expect(cookie(res, 'skyline_oauth')?.maxAge).toBe(0);
  });

  it('открытый редирект через returnTo не проходит', async () => {
    const h = harness();
    const { state, oauthCookie } = await startLogin(h, 'https://evil.example');
    const res = await h.app.inject({
      url: `/api/v1/auth/oauth/google/callback?code=code-1&state=${state}`,
      cookies: { skyline_oauth: oauthCookie?.value ?? '' },
    });
    expect(res.headers.location).toBe(`${PUBLIC_URL}/#/`);
  });

  it.each([
    ['state не совпал', (state: string) => `code=code-1&state=${state}x`, true],
    ['нет cookie состояния (вход начат в другом браузере)', (state: string) => `code=code-1&state=${state}`, false],
    ['пользователь отказался', (state: string) => `error=access_denied&state=${state}`, true],
    ['нет кода', (state: string) => `state=${state}`, true],
  ])('%s — на страницу ошибки, без сессии', async (_name, query, withCookie) => {
    const h = harness();
    const { state, oauthCookie } = await startLogin(h);
    const res = await h.app.inject({
      url: `/api/v1/auth/oauth/google/callback?${query(state)}`,
      cookies: withCookie ? { skyline_oauth: oauthCookie?.value ?? '' } : {},
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/#/auth-failed`);
    expect(h.exchanges).toHaveLength(0);
    expect(h.sessions).toHaveLength(0);
  });

  it('Google отверг код или id_token — на страницу ошибки', async () => {
    const h = harness();
    h.setExchangeFails(true);
    const { state, oauthCookie } = await startLogin(h);
    const res = await h.app.inject({
      url: `/api/v1/auth/oauth/google/callback?code=code-1&state=${state}`,
      cookies: { skyline_oauth: oauthCookie?.value ?? '' },
    });
    expect(res.headers.location).toBe(`${PUBLIC_URL}/#/auth-failed`);
    expect(h.sessions).toHaveLength(0);
  });
});

describe('GET /me', () => {
  it('с access-cookie — профиль по контракту', async () => {
    const res = await harness().app.inject({
      url: '/api/v1/me',
      cookies: { skyline_at: await signAccessToken(USER_ID, SECRET, NOW) },
    });
    expect(res.statusCode).toBe(200);
    expect(MeResponse.parse(res.json())).toEqual(PROFILE);
  });

  it('без cookie или с испорченной — 401 Problem Details', async () => {
    const h = harness();
    for (const cookies of [{}, { skyline_at: 'garbage' }]) {
      const res = await h.app.inject({ url: '/api/v1/me', cookies });
      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    }
  });
});

describe('POST /auth/refresh', () => {
  it('ротация: хэш старого токена в БД, новые cookie', async () => {
    const h = harness();
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { skyline_rt: 'old-token' } });
    expect(res.statusCode).toBe(204);
    expect(h.rotations).toEqual([hashToken('old-token')]);
    const refresh = cookie(res, 'skyline_rt');
    expect(refresh?.value).not.toBe('old-token');
    expect(h.sessions).toHaveLength(0); // новую строку создаёт сама ротация
    expect(cookie(res, 'skyline_at')?.value).toBeTruthy();
  });

  it('недействительный или украденный — 401, cookie стёрты', async () => {
    for (const kind of ['invalid', 'reused'] as const) {
      const h = harness();
      h.setRotate({ kind });
      const res = await h.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { skyline_rt: 'old' } });
      expect(res.statusCode).toBe(401);
      expect(cookie(res, 'skyline_rt')?.maxAge).toBe(0);
      expect(cookie(res, 'skyline_at')?.maxAge).toBe(0);
    }
  });

  it('соседняя вкладка уже сменила токен — 409, cookie не трогаем', async () => {
    const h = harness();
    h.setRotate({ kind: 'stale' });
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { skyline_rt: 'old' } });
    expect(res.statusCode).toBe(409);
    expect(res.cookies).toHaveLength(0);
  });

  it('без cookie — 401, в БД не ходим', async () => {
    const h = harness();
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/auth/refresh' });
    expect(res.statusCode).toBe(401);
    expect(h.rotations).toHaveLength(0);
  });
});

describe('POST /auth/logout', () => {
  it('отзывает сессию и стирает cookie', async () => {
    const h = harness();
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/auth/logout', cookies: { skyline_rt: 'token' } });
    expect(res.statusCode).toBe(204);
    expect(h.revoked).toEqual([hashToken('token')]);
    expect(cookie(res, 'skyline_rt')?.maxAge).toBe(0);
    expect(cookie(res, 'skyline_at')?.maxAge).toBe(0);
  });
});

describe('загрузка полёта', () => {
  const upload = async (h: Harness, cookies: Record<string, string>) => {
    const body = multipartBody([{ field: 'file', filename: 'flight.igc', content: 'AXSK\r\n' }]);
    return h.app.inject({ method: 'POST', url: '/api/v1/flights/upload', cookies, ...body });
  };

  it('вошедший — полёт его, сырой файл в raw/{userId}/', async () => {
    const h = harness();
    const res = await upload(h, { skyline_at: await signAccessToken(USER_ID, SECRET, NOW) });
    expect(res.statusCode).toBe(202);
    expect(h.inserted).toEqual([
      expect.objectContaining({ userId: USER_ID, rawObjectKey: `raw/${USER_ID}/${FLIGHT_ID}.igc.gz` }),
    ]);
  });

  it('без входа или с просроченным токеном — анонимно', async () => {
    const h = harness();
    await upload(h, {});
    await upload(h, { skyline_at: 'expired-or-garbage' });
    expect(h.inserted.map((f) => f.userId)).toEqual([null, null]);
    expect(h.inserted[0]?.rawObjectKey).toBe(`raw/anonymous/${FLIGHT_ID}.igc.gz`);
  });

  it('аноним получает токен, в БД — только его хэш; у вошедшего токена нет', async () => {
    const h = harness();
    const anonymous = await upload(h, {});
    const token = UploadResponse.parse(anonymous.json()).claimToken ?? '';
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(h.inserted[0]?.claimTokenHash).toBe(hashToken(token));

    const owned = await upload(h, { skyline_at: await signAccessToken(USER_ID, SECRET, NOW) });
    expect(owned.json()).not.toHaveProperty('claimToken');
    expect(h.inserted[1]).not.toHaveProperty('claimTokenHash');
  });
});
