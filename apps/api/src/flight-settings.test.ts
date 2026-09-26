import { SharedFlightResponse, ShareLinkResponse } from '@skyline/core';
import type { SetFlightGliderResult } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { AuthDeps } from './auth/routes.js';
import { signAccessToken } from './auth/tokens.js';
import type { FlightSettingsDeps } from './flight-settings.js';

const SECRET = new TextEncoder().encode('test-secret-that-is-at-least-32-bytes!');
const USER_ID = '11111111-2222-4333-8444-555555555555';
const FLIGHT_ID = '22222222-2222-4333-8444-555555555555';
const GLIDER_ID = '44444444-2222-4333-8444-555555555555';
const NOW = new Date(Date.UTC(2026, 8, 27, 12));

function harness(options: { owns?: boolean; glider?: SetFlightGliderResult; shared?: string | null } = {}) {
  const calls: unknown[][] = [];
  const owns = options.owns ?? true;
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
  const settings: FlightSettingsDeps = {
    setGlider: (args) => {
      calls.push(['glider', args]);
      return Promise.resolve(options.glider ?? 'ok');
    },
    setPrivacy: (args) => {
      calls.push(['privacy', args]);
      return Promise.resolve(owns);
    },
    ensureShareToken: (args) => {
      calls.push(['ensure', args]);
      return Promise.resolve(owns ? 'existing-token' : null);
    },
    resetShareToken: (args) => {
      calls.push(['reset', args]);
      return Promise.resolve(owns ? args.newToken : null);
    },
    findShared: (token) => Promise.resolve(options.shared === undefined ? (token === 'good' ? FLIGHT_ID : null) : options.shared),
    newShareToken: () => 'fresh-token',
  };
  return { app: buildApp({ logger: false, auth, flightSettings: settings }), calls };
}

const cookies = async () => ({ skyline_at: await signAccessToken(USER_ID, SECRET, NOW) });
const patch = async (h: ReturnType<typeof harness>, payload: Record<string, unknown>, signedIn = true) =>
  h.app.inject({ method: 'PATCH', url: `/api/v1/flights/${FLIGHT_ID}`, payload, cookies: signedIn ? await cookies() : {} });

describe('PATCH /flights/:id', () => {
  it('крыло и приватность — вместе или по отдельности; 204', async () => {
    const h = harness();
    expect((await patch(h, { gliderId: GLIDER_ID, privacy: 'public' })).statusCode).toBe(204);
    expect(h.calls).toEqual([
      ['glider', { flightId: FLIGHT_ID, userId: USER_ID, gliderId: GLIDER_ID }],
      ['privacy', { flightId: FLIGHT_ID, userId: USER_ID, privacy: 'public' }],
    ]);
  });

  it('пусто, чужой уровень — 400; без входа — 401; чужой полёт или крыло — 404', async () => {
    expect((await patch(harness(), {})).statusCode).toBe(400);
    expect((await patch(harness(), { privacy: 'friends' })).statusCode).toBe(400);
    expect((await patch(harness(), { privacy: 'public' }, false)).statusCode).toBe(401);
    expect((await patch(harness({ owns: false }), { privacy: 'public' })).statusCode).toBe(404);
    expect((await patch(harness({ glider: 'glider_not_found' }), { gliderId: GLIDER_ID })).statusCode).toBe(404);
  });
});

describe('ссылка «по ссылке»', () => {
  it('выдать ссылку — существующий токен; сбросить — новый', async () => {
    const h = harness();
    const share = await h.app.inject({ method: 'POST', url: `/api/v1/flights/${FLIGHT_ID}/share`, cookies: await cookies() });
    expect(ShareLinkResponse.parse(share.json())).toEqual({ token: 'existing-token' });
    const reset = await h.app.inject({ method: 'POST', url: `/api/v1/flights/${FLIGHT_ID}/share/reset`, cookies: await cookies() });
    expect(ShareLinkResponse.parse(reset.json())).toEqual({ token: 'fresh-token' });
  });

  it('чужой полёт — 404; без входа — 401', async () => {
    const url = `/api/v1/flights/${FLIGHT_ID}/share`;
    expect((await harness({ owns: false }).app.inject({ method: 'POST', url, cookies: await cookies() })).statusCode).toBe(404);
    expect((await harness().app.inject({ method: 'POST', url })).statusCode).toBe(401);
  });

  it('GET /share/:token — полёт без входа; неизвестный или личный — 404', async () => {
    const h = harness();
    const ok = await h.app.inject('/api/v1/share/good');
    expect(SharedFlightResponse.parse(ok.json())).toEqual({ flightId: FLIGHT_ID });
    expect((await h.app.inject('/api/v1/share/bad')).statusCode).toBe(404);
  });
});
