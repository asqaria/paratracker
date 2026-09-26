import { GliderDto, GlidersResponse, PROBLEM_CONTENT_TYPE, type GliderInput } from '@skyline/core';
import type { GliderRecord } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { AuthDeps } from './auth/routes.js';
import { signAccessToken } from './auth/tokens.js';
import type { GliderRoutesDeps } from './gliders.js';

const SECRET = new TextEncoder().encode('test-secret-that-is-at-least-32-bytes!');
const USER_ID = '11111111-2222-4333-8444-555555555555';
const GLIDER_ID = '44444444-2222-4333-8444-555555555555';
const NOW = new Date(Date.UTC(2026, 8, 26, 12));

const RUSH: GliderRecord = {
  id: GLIDER_ID,
  manufacturer: 'Ozone',
  model: 'Rush 6',
  size: 'ML',
  certification: 'EN-B',
  isDefault: true,
};

function harness(options: { create?: GliderRecord | null; update?: GliderRecord | null; remove?: boolean } = {}) {
  const calls: unknown[][] = [];
  const auth: AuthDeps = {
    jwtSecret: SECRET,
    publicUrl: 'https://skyline.example',
    google: null,
    users: { signIn: () => Promise.reject(new Error('unused')), profile: () => Promise.resolve(null) },
    sessions: {
      create: () => Promise.resolve(),
      rotate: () => Promise.resolve({ kind: 'invalid' }),
      revoke: () => Promise.resolve(),
    },
    now: () => NOW,
  };
  const gliders: GliderRoutesDeps = {
    list: (userId) => {
      calls.push(['list', userId]);
      return Promise.resolve([RUSH]);
    },
    create: (userId, input) => {
      calls.push(['create', userId, input]);
      return Promise.resolve(options.create === undefined ? RUSH : options.create);
    },
    update: (userId, id, input) => {
      calls.push(['update', userId, id, input]);
      return Promise.resolve(options.update === undefined ? RUSH : options.update);
    },
    remove: (userId, id) => {
      calls.push(['remove', userId, id]);
      return Promise.resolve(options.remove ?? true);
    },
  };
  return { app: buildApp({ logger: false, auth, gliders }), calls };
}

const cookies = async () => ({ skyline_at: await signAccessToken(USER_ID, SECRET, NOW) });
const INPUT: Partial<GliderInput> = { manufacturer: 'Ozone', model: 'Rush 6', size: 'ML', certification: 'EN-B' };

describe('крылья', () => {
  it('без входа — 401 на любой маршрут', async () => {
    const h = harness();
    for (const [method, url] of [
      ['GET', '/api/v1/gliders'],
      ['POST', '/api/v1/gliders'],
      ['PATCH', `/api/v1/gliders/${GLIDER_ID}`],
      ['DELETE', `/api/v1/gliders/${GLIDER_ID}`],
    ] as const) {
      const res = await h.app.inject({ method, url, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
    expect(h.calls).toHaveLength(0);
  });

  it('список по контракту', async () => {
    const res = await harness().app.inject({ url: '/api/v1/gliders', cookies: await cookies() });
    expect(GlidersResponse.parse(res.json())).toEqual({ gliders: [RUSH] });
  });

  it('создание: 201, значения по умолчанию из схемы; лимит — 409; кривое тело — 400', async () => {
    const h = harness();
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/gliders', cookies: await cookies(), payload: INPUT });
    expect(res.statusCode).toBe(201);
    expect(GliderDto.parse(res.json())).toEqual(RUSH);
    expect(h.calls[0]).toEqual(['create', USER_ID, { ...INPUT, isDefault: false }]);

    const full = await harness({ create: null }).app.inject({ method: 'POST', url: '/api/v1/gliders', cookies: await cookies(), payload: INPUT });
    expect(full.statusCode).toBe(409);
    const bad = await h.app.inject({ method: 'POST', url: '/api/v1/gliders', cookies: await cookies(), payload: { model: 'x' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  });

  it('правка и удаление чужого или несуществующего — 404', async () => {
    const opts = { cookies: await cookies(), payload: INPUT };
    expect((await harness({ update: null }).app.inject({ method: 'PATCH', url: `/api/v1/gliders/${GLIDER_ID}`, ...opts })).statusCode).toBe(404);
    expect((await harness({ remove: false }).app.inject({ method: 'DELETE', url: `/api/v1/gliders/${GLIDER_ID}`, cookies: opts.cookies })).statusCode).toBe(404);
    expect((await harness().app.inject({ method: 'DELETE', url: `/api/v1/gliders/${GLIDER_ID}`, cookies: opts.cookies })).statusCode).toBe(204);
  });
});
