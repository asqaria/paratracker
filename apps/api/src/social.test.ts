import { FeedResponse, FollowResponse, LikeResponse } from '@skyline/core';
import type { FeedRecord, FlightRecord } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { AuthDeps } from './auth/routes.js';
import { signAccessToken } from './auth/tokens.js';

const SECRET = new TextEncoder().encode('test-secret-that-is-at-least-32-bytes!');
const VIEWER = '11111111-2222-4333-8444-555555555555';
const OWNER = '33333333-2222-4333-8444-555555555555';
const PUBLIC_FLIGHT = '22222222-2222-4333-8444-555555555555';
const UNLISTED_FLIGHT = '44444444-2222-4333-8444-555555555555';
const NOW = new Date(Date.UTC(2026, 8, 27, 12));
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

const record = (id: string, privacy: FlightRecord['privacy']): FlightRecord => ({
  id,
  status: 'ready',
  sourceFormat: 'igc',
  rawObjectKey: `raw/${id}.igc.gz`,
  trackObjectKey: `tracks/${id}.track`,
  errorCode: null,
  userId: OWNER,
  privacy,
  shareToken: privacy === 'unlisted' ? 'goodToken_12' : null,
  publicTrackObjectKey: null,
  previewObjectKey: `previews/${id}.jpg`,
});

const ITEM: FeedRecord = {
  flightId: PUBLIC_FLIGHT,
  pilot: { username: 'owner', displayName: 'Айгерим', avatarUrl: null },
  startedAt: new Date(Date.UTC(2026, 6, 15, 6)),
  timezone: 'Asia/Almaty',
  siteName: 'Ush Konyr',
  airtimeS: 3600,
  distanceTrackM: 40_000,
  maxAltM: 3000,
  xcScore: 55.5,
  likeCount: 2,
  likedByMe: false,
  hasPreview: true,
};

function harness() {
  const calls: unknown[][] = [];
  const auth: AuthDeps = {
    jwtSecret: SECRET,
    publicUrl: 'https://skyline.example',
    google: null,
    users: {
      signIn: () => Promise.reject(new Error('unused')),
      profile: () => Promise.resolve(null),
      update: () => Promise.reject(new Error('unused')),
    },
    sessions: {
      create: () => Promise.resolve(),
      rotate: () => Promise.resolve({ kind: 'invalid' }),
      revoke: () => Promise.resolve(),
    },
    now: () => NOW,
  };
  const app = buildApp({
    logger: false,
    auth,
    social: {
      feed: (query) => {
        calls.push(['feed', query]);
        return Promise.resolve({ items: [ITEM], next: { startedAt: ITEM.startedAt, id: ITEM.flightId } });
      },
      flight: (id) =>
        Promise.resolve(id === PUBLIC_FLIGHT ? record(id, 'public') : id === UNLISTED_FLIGHT ? record(id, 'unlisted') : null),
      setLike: (userId, flightId, liked) => {
        calls.push(['like', userId, flightId, liked]);
        return Promise.resolve({ liked, likeCount: liked ? 3 : 2 });
      },
      userIdOf: (username) => Promise.resolve(username === 'owner' ? OWNER : null),
      setFollow: (followerId, followeeId, following) => {
        calls.push(['follow', followerId, followeeId, following]);
        return Promise.resolve({ following, followers: following ? 1 : 0 });
      },
      storage: { get: () => Promise.resolve(JPEG) },
    },
  });
  return { app, calls };
}

const cookies = async () => ({ skyline_at: await signAccessToken(VIEWER, SECRET, NOW) });

describe('GET /feed', () => {
  it('«Все» без входа: карточки, время ISO, курсор для следующей страницы', async () => {
    const h = harness();
    const res = await h.app.inject({ url: '/api/v1/feed' });
    expect(res.statusCode).toBe(200);
    const page = FeedResponse.parse(res.json());
    expect(page.items[0]).toMatchObject({ flightId: PUBLIC_FLIGHT, startedAt: '2026-07-15T06:00:00.000Z', likeCount: 2 });
    await h.app.inject({ url: `/api/v1/feed?cursor=${page.nextCursor ?? ''}&limit=5` });
    expect(h.calls).toEqual([
      ['feed', { viewerId: null, scope: 'all', limit: 20 }],
      ['feed', { viewerId: null, scope: 'all', limit: 5, after: { startedAt: ITEM.startedAt, id: PUBLIC_FLIGHT } }],
    ]);
  });

  it('«Подписки» — только вошедшему; кривой курсор — 400', async () => {
    const h = harness();
    expect((await h.app.inject({ url: '/api/v1/feed?scope=following' })).statusCode).toBe(401);
    expect((await h.app.inject({ url: '/api/v1/feed?scope=following', cookies: await cookies() })).statusCode).toBe(200);
    expect((await h.app.inject({ url: '/api/v1/feed?cursor=garbage' })).statusCode).toBe(400);
  });
});

describe('POST/DELETE /flights/:id/like', () => {
  it('вошедший лайкает видимый полёт и снимает лайк', async () => {
    const h = harness();
    const liked = await h.app.inject({ method: 'POST', url: `/api/v1/flights/${PUBLIC_FLIGHT}/like`, cookies: await cookies() });
    expect(LikeResponse.parse(liked.json())).toEqual({ liked: true, likeCount: 3 });
    const unliked = await h.app.inject({ method: 'DELETE', url: `/api/v1/flights/${PUBLIC_FLIGHT}/like`, cookies: await cookies() });
    expect(LikeResponse.parse(unliked.json())).toEqual({ liked: false, likeCount: 2 });
  });

  it('«По ссылке» — только с токеном; без входа — 401; нет полёта — 404', async () => {
    const h = harness();
    const signed = await cookies();
    expect((await h.app.inject({ method: 'POST', url: `/api/v1/flights/${UNLISTED_FLIGHT}/like`, cookies: signed })).statusCode).toBe(404);
    expect(
      (await h.app.inject({ method: 'POST', url: `/api/v1/flights/${UNLISTED_FLIGHT}/like?share=goodToken_12`, cookies: signed }))
        .statusCode,
    ).toBe(200);
    expect((await h.app.inject({ method: 'POST', url: `/api/v1/flights/${PUBLIC_FLIGHT}/like` })).statusCode).toBe(401);
    expect(h.calls.filter((c) => c[0] === 'like')).toEqual([['like', VIEWER, UNLISTED_FLIGHT, true]]);
  });
});

describe('POST/DELETE /users/:username/follow', () => {
  it('подписка по логину; нет пилота — 404; без входа — 401', async () => {
    const h = harness();
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/users/Owner/follow', cookies: await cookies() });
    expect(FollowResponse.parse(res.json())).toEqual({ following: true, followers: 1 });
    expect((await h.app.inject({ method: 'POST', url: '/api/v1/users/nobody/follow', cookies: await cookies() })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'DELETE', url: '/api/v1/users/owner/follow' })).statusCode).toBe(401);
    expect(h.calls).toEqual([['follow', VIEWER, OWNER, true]]);
  });
});

describe('GET /flights/:id/preview.jpg', () => {
  it('картинка видимого полёта, личный кеш; невидимого — 404', async () => {
    const h = harness();
    const res = await h.app.inject({ url: `/api/v1/flights/${PUBLIC_FLIGHT}/preview.jpg` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toContain('private');
    expect((await h.app.inject({ url: `/api/v1/flights/${UNLISTED_FLIGHT}/preview.jpg` })).statusCode).toBe(404);
  });
});
