import { CommentDto, CommentsResponse } from '@skyline/core';
import type { CommentRecord, CommentRef, FlightRecord } from '@skyline/db';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { AuthDeps } from './auth/routes.js';
import { signAccessToken } from './auth/tokens.js';

const SECRET = new TextEncoder().encode('test-secret-that-is-at-least-32-bytes!');
const OWNER = '11111111-2222-4333-8444-555555555555';
const COACH = '33333333-2222-4333-8444-555555555555';
const STRANGER = '66666666-2222-4333-8444-555555555555';
const FLIGHT = '22222222-2222-4333-8444-555555555555';
const UNLISTED = '44444444-2222-4333-8444-555555555555';
const ROOT = '77777777-2222-4333-8444-555555555555';
const REPLY = '88888888-2222-4333-8444-555555555555';
const NOW = new Date(Date.UTC(2026, 8, 27, 12));

const flight = (id: string, privacy: FlightRecord['privacy']): FlightRecord => ({
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
  previewObjectKey: null,
});

const record = (id: string, userId: string, parentId: string | null, body: string): CommentRecord => ({
  id,
  flightId: FLIGHT,
  parentId,
  userId,
  author: { username: userId === COACH ? 'coach' : 'owner', displayName: null, avatarUrl: null },
  body,
  timecodeS: parentId === null ? 5020 : null,
  createdAt: NOW,
});

function harness() {
  const calls: unknown[][] = [];
  const stored: CommentRecord[] = [record(ROOT, COACH, null, 'Здесь ушёл из термика'), record(REPLY, OWNER, ROOT, 'А куда?')];
  const refs: Record<string, CommentRef> = {
    [ROOT]: { id: ROOT, flightId: FLIGHT, userId: COACH, parentId: null, deleted: false },
    [REPLY]: { id: REPLY, flightId: FLIGHT, userId: OWNER, parentId: ROOT, deleted: false },
  };
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
    comments: {
      flight: (id) => Promise.resolve(id === FLIGHT ? flight(id, 'public') : id === UNLISTED ? flight(id, 'unlisted') : null),
      list: () => Promise.resolve(stored),
      find: (id) => Promise.resolve(refs[id] ?? null),
      add: (comment) => {
        calls.push(['add', comment]);
        const id = '99999999-2222-4333-8444-555555555555';
        stored.push({ ...record(id, comment.userId, comment.parentId, comment.body), timecodeS: comment.timecodeS });
        return Promise.resolve(id);
      },
      remove: (id) => {
        calls.push(['remove', id]);
        return Promise.resolve();
      },
    },
  });
  return { app, calls };
}

const as = async (userId: string) => ({ skyline_at: await signAccessToken(userId, SECRET, NOW) });

describe('GET /flights/:id/comments', () => {
  it('список по контракту; удалить может автор и владелец полёта', async () => {
    const h = harness();
    const asCoach = CommentsResponse.parse((await h.app.inject({ url: `/api/v1/flights/${FLIGHT}/comments`, cookies: await as(COACH) })).json());
    expect(asCoach.comments.map((c) => [c.id, c.parentId, c.timecodeS, c.canDelete])).toEqual([
      [ROOT, null, 5020, true],
      [REPLY, ROOT, null, false],
    ]);
    const asOwner = CommentsResponse.parse((await h.app.inject({ url: `/api/v1/flights/${FLIGHT}/comments`, cookies: await as(OWNER) })).json());
    expect(asOwner.comments.map((c) => c.canDelete)).toEqual([true, true]);
    const anonymous = CommentsResponse.parse((await h.app.inject({ url: `/api/v1/flights/${FLIGHT}/comments` })).json());
    expect(anonymous.comments.map((c) => c.canDelete)).toEqual([false, false]);
  });

  it('«По ссылке» — только с токеном', async () => {
    const h = harness();
    expect((await h.app.inject({ url: `/api/v1/flights/${UNLISTED}/comments` })).statusCode).toBe(404);
    expect((await h.app.inject({ url: `/api/v1/flights/${UNLISTED}/comments?share=goodToken_12` })).statusCode).toBe(200);
  });
});

describe('POST /flights/:id/comments', () => {
  it('вошедший пишет с моментом полёта — 201 и комментарий по контракту', async () => {
    const h = harness();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/flights/${FLIGHT}/comments`,
      cookies: await as(STRANGER),
      payload: { body: '  Красиво  ', timecodeS: 120 },
    });
    expect(res.statusCode).toBe(201);
    expect(CommentDto.parse(res.json())).toMatchObject({ body: 'Красиво', timecodeS: 120, parentId: null, canDelete: true });
    expect(h.calls).toEqual([['add', { flightId: FLIGHT, userId: STRANGER, parentId: null, body: 'Красиво', timecodeS: 120 }]]);
  });

  it('ответ на ответ, пустой текст, без входа — отказ', async () => {
    const h = harness();
    const post = async (payload: Record<string, unknown>, signedIn = true) =>
      (
        await h.app.inject({
          method: 'POST',
          url: `/api/v1/flights/${FLIGHT}/comments`,
          cookies: signedIn ? await as(STRANGER) : {},
          payload,
        })
      ).statusCode;
    expect(await post({ body: 'ещё', parentId: REPLY })).toBe(400);
    expect(await post({ body: '   ' })).toBe(400);
    expect(await post({ body: 'x' }, false)).toBe(401);
    expect(await post({ body: 'ответ', parentId: ROOT })).toBe(201);
  });
});

describe('DELETE /flights/:id/comments/:commentId', () => {
  it('автор и владелец полёта — да, посторонний — 403', async () => {
    const h = harness();
    const del = async (commentId: string, userId: string) =>
      (await h.app.inject({ method: 'DELETE', url: `/api/v1/flights/${FLIGHT}/comments/${commentId}`, cookies: await as(userId) }))
        .statusCode;
    expect(await del(ROOT, STRANGER)).toBe(403);
    expect(await del(ROOT, COACH)).toBe(204);
    expect(await del(ROOT, OWNER)).toBe(204);
    expect(h.calls).toEqual([
      ['remove', ROOT],
      ['remove', ROOT],
    ]);
  });
});
