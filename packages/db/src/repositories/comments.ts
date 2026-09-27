import { and, asc, eq, isNull, sql, type AnyColumn } from 'drizzle-orm';

import type { Database } from '../client.js';
import { comments, users } from '../schema.js';

/**
 * Комментарии к полёту (задача 3.10б). Кто видит полёт и кто может писать —
 * решает API; здесь — данные. Удалённый с ответами остаётся строкой без
 * текста, без ответов — удаляется целиком.
 */

export interface CommentRecord {
  id: string;
  flightId: string;
  parentId: string | null;
  userId: string;
  author: { username: string; displayName: string | null; avatarUrl: string | null };
  /** null — удалён (строка оставлена ради ответов). */
  body: string | null;
  timecodeS: number | null;
  createdAt: Date;
}

/**
 * Есть живые ответы. Имена таблиц — явно: в запросе к одной таблице Drizzle
 * пишет колонки без неё, и comments.id внутри подзапроса значил бы reply.id.
 */
const hasLiveReplies = sql<boolean>`exists (
  select 1 from comments as reply
  where reply.parent_id = comments.id and reply.deleted_at is null
)`;

/** Комментарии полёта по времени; удалённые без живых ответов не показываются. */
export async function listComments(db: Database, flightId: string): Promise<CommentRecord[]> {
  const rows = await db
    .select({
      id: comments.id,
      flightId: comments.flightId,
      parentId: comments.parentId,
      userId: comments.userId,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      body: comments.body,
      deletedAt: comments.deletedAt,
      timecodeS: comments.timecodeS,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(and(eq(comments.flightId, flightId), sql`(${comments.deletedAt} is null or ${hasLiveReplies})`))
    .orderBy(asc(comments.createdAt), asc(comments.id));
  return rows.map((row) => ({
    id: row.id,
    flightId: row.flightId,
    parentId: row.parentId,
    userId: row.userId,
    author: { username: row.username, displayName: row.displayName, avatarUrl: row.avatarUrl },
    body: row.deletedAt === null ? row.body : null,
    timecodeS: row.timecodeS,
    createdAt: row.createdAt,
  }));
}

export interface CommentRef {
  id: string;
  flightId: string;
  userId: string;
  parentId: string | null;
  deleted: boolean;
}

export async function findComment(db: Database, id: string): Promise<CommentRef | null> {
  const [row] = await db
    .select({
      id: comments.id,
      flightId: comments.flightId,
      userId: comments.userId,
      parentId: comments.parentId,
      deletedAt: comments.deletedAt,
    })
    .from(comments)
    .where(eq(comments.id, id));
  return row ? { id: row.id, flightId: row.flightId, userId: row.userId, parentId: row.parentId, deleted: row.deletedAt !== null } : null;
}

export async function addComment(
  db: Database,
  comment: { flightId: string; userId: string; parentId: string | null; body: string; timecodeS: number | null },
): Promise<string> {
  const [row] = await db.insert(comments).values(comment).returning({ id: comments.id });
  if (!row) throw new Error('addComment returned no row');
  return row.id;
}

/**
 * Удалить комментарий. С живыми ответами — остаётся строкой без текста.
 * Ответ, после которого у удалённого родителя не осталось живых ответов,
 * уносит и родителя: пустая плашка «удалён» без ответов не нужна.
 */
export async function deleteComment(db: Database, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ parentId: comments.parentId, replies: hasLiveReplies })
      .from(comments)
      .where(eq(comments.id, id));
    if (!target) return;
    if (target.replies) {
      await tx.update(comments).set({ deletedAt: new Date(), body: '' }).where(eq(comments.id, id));
      return;
    }
    await tx.delete(comments).where(eq(comments.id, id));
    if (target.parentId !== null) {
      await tx
        .delete(comments)
        .where(
          and(
            eq(comments.id, target.parentId),
            sql`${comments.deletedAt} is not null`,
            sql`not exists (select 1 from ${comments} as reply where reply.parent_id = ${target.parentId}::uuid and reply.deleted_at is null)`,
          ),
        );
    }
  });
}

/** Живые комментарии полёта — для счётчика в ленте. */
export const liveCommentCount = (flightIdColumn: AnyColumn) =>
  sql<number>`(select count(*)::int from ${comments} where ${comments.flightId} = ${flightIdColumn} and ${isNull(comments.deletedAt)})`;
