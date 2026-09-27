import type { FeedScope } from '@skyline/core';
import { and, count, desc, eq, exists, gt, isNotNull, sql, type SQL } from 'drizzle-orm';

import type { Database } from '../client.js';
import { flights, follows, likes, sites, users } from '../schema.js';
import { liveCommentCount } from './comments.js';

/**
 * Лента, лайки и подписки (задача 3.10а). Кто видит полёт — решает вызывающий
 * (apps/api access.ts); здесь — только данные. В ленте — только полёты «Все».
 */

export interface LikeState {
  liked: boolean;
  likeCount: number;
}

/**
 * Лайк или его снятие. Счётчик пересчитывается по таблице в той же транзакции:
 * двойной клик и гонка двух вкладок не собьют его.
 */
export async function setLike(db: Database, userId: string, flightId: string, liked: boolean): Promise<LikeState> {
  return db.transaction(async (tx) => {
    if (liked) await tx.insert(likes).values({ userId, flightId }).onConflictDoNothing();
    else await tx.delete(likes).where(and(eq(likes.userId, userId), eq(likes.flightId, flightId)));
    const [row] = await tx
      .update(flights)
      .set({ likeCount: sql`(select count(*)::int from ${likes} where ${likes.flightId} = ${flightId})` })
      .where(eq(flights.id, flightId))
      .returning({ likeCount: flights.likeCount });
    return { liked, likeCount: row?.likeCount ?? 0 };
  });
}

export async function likedBy(db: Database, userId: string, flightId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: likes.userId })
    .from(likes)
    .where(and(eq(likes.userId, userId), eq(likes.flightId, flightId)))
    .limit(1);
  return row !== undefined;
}

export interface FollowState {
  following: boolean;
  followers: number;
}

const followersOf = async (db: Pick<Database, 'select'>, userId: string): Promise<number> => {
  const [row] = await db.select({ n: count() }).from(follows).where(eq(follows.followeeId, userId));
  return row?.n ?? 0;
};

/** Подписка или отписка; на себя — база не даст (follows_not_self_check), здесь — тоже нет. */
export async function setFollow(db: Database, followerId: string, followeeId: string, following: boolean): Promise<FollowState> {
  if (followerId === followeeId) return { following: false, followers: await followersOf(db, followeeId) };
  if (following) await db.insert(follows).values({ followerId, followeeId }).onConflictDoNothing();
  else await db.delete(follows).where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)));
  return { following, followers: await followersOf(db, followeeId) };
}

export interface FollowCounts {
  followers: number;
  following: number;
  followedByViewer: boolean;
}

export async function followCounts(db: Database, userId: string, viewerId: string | null): Promise<FollowCounts> {
  const [following] = await db.select({ n: count() }).from(follows).where(eq(follows.followerId, userId));
  const [mine] =
    viewerId === null || viewerId === userId
      ? []
      : await db
          .select({ n: count() })
          .from(follows)
          .where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, userId)));
  return {
    followers: await followersOf(db, userId),
    following: following?.n ?? 0,
    followedByViewer: (mine?.n ?? 0) > 0,
  };
}

export interface FeedRecord {
  flightId: string;
  pilot: { username: string; displayName: string | null; avatarUrl: string | null };
  startedAt: Date;
  timezone: string | null;
  siteName: string | null;
  airtimeS: number | null;
  distanceTrackM: number | null;
  maxAltM: number | null;
  xcScore: number | null;
  likeCount: number;
  likedByMe: boolean;
  hasPreview: boolean;
  /** Живые комментарии (задача 3.10б). */
  commentCount: number;
}

export interface FeedCursor {
  startedAt: Date;
  id: string;
}

export interface FeedPage {
  items: FeedRecord[];
  next: FeedCursor | null;
}

/**
 * Лента: полёты «Все», готовые и с полётом в записи, новые сверху (по старту,
 * при равенстве — по id). «Подписки» — только пилотов, на которых подписан
 * вошедший; без входа эта вкладка пустая — решает API (401).
 */
export async function listFeed(
  db: Database,
  query: { viewerId: string | null; scope: FeedScope; limit: number; after?: FeedCursor },
): Promise<FeedPage> {
  const conditions: SQL[] = [
    eq(flights.privacy, 'public'),
    eq(flights.status, 'ready'),
    gt(flights.airtimeS, 0),
    isNotNull(flights.startedAt),
    isNotNull(flights.userId),
  ];
  if (query.scope === 'following' && query.viewerId !== null) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(follows)
          .where(and(eq(follows.followerId, query.viewerId), eq(follows.followeeId, flights.userId))),
      ),
    );
  }
  if (query.after) {
    conditions.push(
      sql`(${flights.startedAt}, ${flights.id}) < (${query.after.startedAt.toISOString()}::timestamptz, ${query.after.id}::uuid)`,
    );
  }
  const likedByMe =
    query.viewerId === null
      ? sql<boolean>`false`
      : sql<boolean>`exists (select 1 from ${likes} where ${likes.flightId} = ${flights.id} and ${likes.userId} = ${query.viewerId})`;

  const rows = await db
    .select({
      flightId: flights.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      startedAt: flights.startedAt,
      timezone: flights.timezone,
      siteName: sites.name,
      airtimeS: flights.airtimeS,
      distanceTrackM: flights.distanceTrackM,
      maxAltM: flights.maxAltM,
      xcScore: flights.xcScore,
      likeCount: flights.likeCount,
      likedByMe,
      hasPreview: sql<boolean>`${flights.previewObjectKey} is not null`,
      commentCount: liveCommentCount(flights.id),
    })
    .from(flights)
    .innerJoin(users, eq(users.id, flights.userId))
    .leftJoin(sites, eq(sites.id, flights.takeoffSiteId))
    .where(and(...conditions))
    .orderBy(desc(flights.startedAt), desc(flights.id))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit).map((row) => ({
    flightId: row.flightId,
    pilot: { username: row.username, displayName: row.displayName, avatarUrl: row.avatarUrl },
    startedAt: row.startedAt ?? new Date(0),
    timezone: row.timezone,
    siteName: row.siteName,
    airtimeS: row.airtimeS,
    distanceTrackM: row.distanceTrackM,
    maxAltM: row.maxAltM,
    xcScore: row.xcScore,
    likeCount: row.likeCount,
    likedByMe: row.likedByMe,
    hasPreview: row.hasPreview,
    commentCount: row.commentCount,
  }));
  const last = page.at(-1);
  return { items: page, next: rows.length > query.limit && last ? { startedAt: last.startedAt, id: last.flightId } : null };
}
