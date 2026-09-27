import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { flights, users } from '../schema.js';
import { insertFlight } from './flights.js';
import { followCounts, likedBy, listFeed, setFollow, setLike } from './social.js';

const databaseUrl = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);
/** Далеко в будущем: лента новые сверху — полёты теста окажутся первыми. */
const FUTURE = Date.UTC(2099, 0, 1) + (Date.now() % 1_000_000);

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('лента, лайки и подписки (задача 3.10а) на живой БД', () => {
  let connection: DatabaseConnection;
  let viewer: string;
  let followed: string;
  let stranger: string;
  const createdUsers: string[] = [];
  const createdFlights: string[] = [];
  const feed: Record<string, string> = {};

  const user = async (name: string): Promise<string> => {
    const [row] = await connection.db
      .insert(users)
      .values({ email: `${name}-${RUN}@example.com`, username: `${name}-${RUN}`, displayName: `Пилот ${name}` })
      .returning({ id: users.id });
    if (!row) throw new Error('user insert returned no row');
    createdUsers.push(row.id);
    return row.id;
  };

  const flight = async (userId: string, minutes: number, privacy: 'public' | 'unlisted' | 'private'): Promise<string> => {
    const created = await insertFlight(connection.db, {
      userId,
      sourceFormat: 'igc',
      rawObjectKey: `raw/test/${RUN}-${createdFlights.length}.igc.gz`,
    });
    createdFlights.push(created.id);
    await connection.db
      .update(flights)
      .set({ privacy, status: 'ready', airtimeS: 1800, startedAt: new Date(FUTURE + minutes * 60_000) })
      .where(eq(flights.id, created.id));
    return created.id;
  };

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    viewer = await user('feed-viewer');
    followed = await user('feed-followed');
    stranger = await user('feed-stranger');
    feed.followedNew = await flight(followed, 30, 'public');
    feed.strangerMid = await flight(stranger, 20, 'public');
    feed.followedOld = await flight(followed, 10, 'public');
    feed.followedHidden = await flight(followed, 40, 'unlisted');
  });

  afterAll(async () => {
    if (createdFlights.length > 0) await connection.db.delete(flights).where(inArray(flights.id, createdFlights));
    if (createdUsers.length > 0) await connection.db.delete(users).where(inArray(users.id, createdUsers));
    await connection.close();
  });

  const ours = (ids: string[]) => ids.filter((id) => createdFlights.includes(id));

  it('лайк: повторный не удваивает счётчик; снятие — обратно; «лайкнул ли» — по таблице', async () => {
    expect(await setLike(connection.db, viewer, feed.followedNew ?? '', true)).toEqual({ liked: true, likeCount: 1 });
    expect(await setLike(connection.db, viewer, feed.followedNew ?? '', true)).toEqual({ liked: true, likeCount: 1 });
    expect(await setLike(connection.db, stranger, feed.followedNew ?? '', true)).toEqual({ liked: true, likeCount: 2 });
    expect(await likedBy(connection.db, viewer, feed.followedNew ?? '')).toBe(true);
    expect(await setLike(connection.db, stranger, feed.followedNew ?? '', false)).toEqual({ liked: false, likeCount: 1 });
  });

  it('подписка: считается, повтор — без дублей; на себя — нельзя', async () => {
    expect(await setFollow(connection.db, viewer, followed, true)).toEqual({ following: true, followers: 1 });
    expect(await setFollow(connection.db, viewer, followed, true)).toEqual({ following: true, followers: 1 });
    expect(await setFollow(connection.db, viewer, viewer, true)).toEqual({ following: false, followers: 0 });
    expect(await followCounts(connection.db, followed, viewer)).toEqual({ followers: 1, following: 0, followedByViewer: true });
    expect(await followCounts(connection.db, viewer, null)).toEqual({ followers: 0, following: 1, followedByViewer: false });
  });

  it('лента «Все»: только полёты «Все», новые сверху; лайк вошедшего виден', async () => {
    const page = await listFeed(connection.db, { viewerId: viewer, scope: 'all', limit: 50 });
    expect(ours(page.items.map((item) => item.flightId))).toEqual([feed.followedNew, feed.strangerMid, feed.followedOld]);
    const liked = page.items.find((item) => item.flightId === feed.followedNew);
    expect(liked).toMatchObject({ likeCount: 1, likedByMe: true, pilot: { displayName: 'Пилот feed-followed' } });
  });

  it('«Подписки» — только тех, на кого подписан; курсор листает без повторов', async () => {
    const first = await listFeed(connection.db, { viewerId: viewer, scope: 'following', limit: 1 });
    expect(first.items.map((item) => item.flightId)).toEqual([feed.followedNew]);
    const second = await listFeed(connection.db, {
      viewerId: viewer,
      scope: 'following',
      limit: 5,
      ...(first.next ? { after: first.next } : {}),
    });
    expect(second.items.map((item) => item.flightId)).toEqual([feed.followedOld]);
    expect(second.next).toBeNull();
  });
});
