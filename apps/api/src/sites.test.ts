import { PROBLEM_CONTENT_TYPE, SiteSummary } from '@skyline/core';
import type { CreateSiteResult } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { AuthDeps } from './auth/routes.js';
import { signAccessToken } from './auth/tokens.js';
import type { SiteRoutesDeps } from './sites.js';

const SECRET = new TextEncoder().encode('test-secret-that-is-at-least-32-bytes!');
const USER_ID = '11111111-2222-4333-8444-555555555555';
const FLIGHT_ID = '22222222-2222-4333-8444-555555555555';
const SITE_ID = '33333333-2222-4333-8444-555555555555';
const NOW = new Date(Date.UTC(2026, 8, 26, 12));

function harness(result: CreateSiteResult) {
  const calls: Parameters<SiteRoutesDeps['create']>[0][] = [];
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
  const sites: SiteRoutesDeps = {
    create: (args) => {
      calls.push(args);
      return Promise.resolve(result);
    },
  };
  return { app: buildApp({ logger: false, auth, sites }), calls };
}

const post = async (h: ReturnType<typeof harness>, payload: Record<string, unknown>, signedIn = true) =>
  h.app.inject({
    method: 'POST',
    url: '/api/v1/sites',
    payload,
    cookies: signedIn ? { skyline_at: await signAccessToken(USER_ID, SECRET, NOW) } : {},
  });

describe('POST /api/v1/sites', () => {
  const created: CreateSiteResult = {
    kind: 'created',
    site: { id: SITE_ID, name: 'Көктөбе', countryCode: null, source: 'user' },
  };

  it('201: место создано от имени вошедшего, имя без пробелов по краям', async () => {
    const h = harness(created);
    const res = await post(h, { flightId: FLIGHT_ID, name: '  Көктөбе  ' });
    expect(res.statusCode).toBe(201);
    expect(SiteSummary.parse(res.json())).toEqual(created.site);
    expect(h.calls).toEqual([{ flightId: FLIGHT_ID, name: 'Көктөбе', userId: USER_ID }]);
  });

  it('без входа — 401, в репозиторий не ходим', async () => {
    const h = harness(created);
    const res = await post(h, { flightId: FLIGHT_ID, name: 'Көктөбе' }, false);
    expect(res.statusCode).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('короткое имя — 400', async () => {
    expect((await post(harness(created), { flightId: FLIGHT_ID, name: ' x ' })).statusCode).toBe(400);
  });

  it.each([
    ['not_found', 404],
    ['has_site', 409],
    ['no_takeoff', 409],
  ] as const)('%s — %i Problem Details', async (kind, status) => {
    const res = await post(harness({ kind }), { flightId: FLIGHT_ID, name: 'Көктөбе' });
    expect(res.statusCode).toBe(status);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  });
});
