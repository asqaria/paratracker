import type { ThermalReviewLabels } from '@skyline/core';
import { and, eq } from 'drizzle-orm';

import type { Database } from '../client.js';
import { flights, thermalReviews } from '../schema.js';

/** Сверка термиков (DoD фазы 2). Только владелец полёта читает и пишет свою разметку. */

export interface ThermalReviewRecord {
  labels: ThermalReviewLabels;
  updatedAt: Date;
}

/** null — полёта нет или он чужой; review null — сверки ещё не было. */
export async function findThermalReview(
  db: Database,
  flightId: string,
  userId: string,
): Promise<{ review: ThermalReviewRecord | null; startedAt: Date | null } | null> {
  const [row] = await db
    .select({ startedAt: flights.startedAt, labels: thermalReviews.labels, updatedAt: thermalReviews.updatedAt })
    .from(flights)
    .leftJoin(thermalReviews, eq(thermalReviews.flightId, flights.id))
    .where(and(eq(flights.id, flightId), eq(flights.userId, userId)));
  if (!row) return null;
  return {
    startedAt: row.startedAt,
    review: row.labels && row.updatedAt ? { labels: row.labels, updatedAt: row.updatedAt } : null,
  };
}

/** false — полёта нет или он чужой. */
export async function saveThermalReview(
  db: Database,
  args: { flightId: string; userId: string; labels: ThermalReviewLabels },
): Promise<boolean> {
  const [flight] = await db
    .select({ id: flights.id })
    .from(flights)
    .where(and(eq(flights.id, args.flightId), eq(flights.userId, args.userId)));
  if (!flight) return false;
  const now = new Date();
  await db
    .insert(thermalReviews)
    .values({ flightId: args.flightId, userId: args.userId, labels: args.labels, updatedAt: now })
    .onConflictDoUpdate({ target: thermalReviews.flightId, set: { labels: args.labels, userId: args.userId, updatedAt: now } });
  return true;
}
