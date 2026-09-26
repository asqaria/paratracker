import type { Privacy } from '@skyline/core';
import { and, eq, ne, sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { flights } from '../schema.js';

/**
 * Приватность и ссылки полёта (задача 3.7). Токен ссылки хранится как есть:
 * владелец копирует ссылку снова и снова, а утечка базы и так открывает всё.
 * «Сбросить ссылку» выдаёт новый токен — старая ссылка перестаёт работать.
 */

/** false — полёта нет или он чужой. */
export async function setFlightPrivacy(
  db: Database,
  args: { flightId: string; userId: string; privacy: Privacy },
): Promise<boolean> {
  const rows = await db
    .update(flights)
    .set({ privacy: args.privacy, updatedAt: new Date() })
    .where(and(eq(flights.id, args.flightId), eq(flights.userId, args.userId)))
    .returning({ id: flights.id });
  return rows.length > 0;
}

/** Токен ссылки: существующий или новый (newToken). null — полёта нет или он чужой. */
export async function ensureShareToken(
  db: Database,
  args: { flightId: string; userId: string; newToken: string },
): Promise<string | null> {
  const [row] = await db
    .update(flights)
    .set({ shareToken: sql`coalesce(${flights.shareToken}, ${args.newToken})` })
    .where(and(eq(flights.id, args.flightId), eq(flights.userId, args.userId)))
    .returning({ token: flights.shareToken });
  return row?.token ?? null;
}

/** Новый токен вместо старого: старая ссылка перестаёт открывать полёт. */
export async function resetShareToken(
  db: Database,
  args: { flightId: string; userId: string; newToken: string },
): Promise<string | null> {
  const [row] = await db
    .update(flights)
    .set({ shareToken: args.newToken, updatedAt: new Date() })
    .where(and(eq(flights.id, args.flightId), eq(flights.userId, args.userId)))
    .returning({ token: flights.shareToken });
  return row?.token ?? null;
}

/** Какой полёт открывает ссылка; личный («только я») — никакой. */
export async function findSharedFlight(db: Database, token: string): Promise<string | null> {
  const [row] = await db
    .select({ id: flights.id })
    .from(flights)
    .where(and(eq(flights.shareToken, token), ne(flights.privacy, 'private')));
  return row?.id ?? null;
}
