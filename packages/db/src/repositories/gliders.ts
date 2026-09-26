import { GLIDER, type GliderCertification, type GliderInput } from '@skyline/core';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';

import type { Database } from '../client.js';
import { flights, gliders } from '../schema.js';

/** Крылья пилота (задача 2.13б). Всё — в рамках одного пилота: чужое крыло не видно и не меняется. */

export interface GliderRecord {
  id: string;
  manufacturer: string;
  model: string;
  size: string | null;
  certification: GliderCertification | null;
  isDefault: boolean;
}

/** Крыло в строке полёта: подпись собирает API (gliderLabel). */
export interface GliderRef {
  id: string;
  manufacturer: string;
  model: string;
  size: string | null;
}

export const GLIDER_COLUMNS = {
  id: gliders.id,
  manufacturer: gliders.manufacturer,
  model: gliders.model,
  size: gliders.size,
} as const;

const RECORD_COLUMNS = { ...GLIDER_COLUMNS, certification: gliders.certification, isDefault: gliders.isDefault } as const;

/** Подзапрос: крыло пилота по умолчанию или NULL — для значения glider_id полёта. */
export const defaultGliderId = (userId: string): SQL =>
  sql`(select ${gliders.id} from ${gliders} where ${gliders.userId} = ${userId} and ${gliders.isDefault})`;

const mine = (userId: string, id: string) => and(eq(gliders.id, id), eq(gliders.userId, userId));

export async function listGliders(db: Database, userId: string): Promise<GliderRecord[]> {
  return db
    .select(RECORD_COLUMNS)
    .from(gliders)
    .where(eq(gliders.userId, userId))
    .orderBy(desc(gliders.isDefault), asc(gliders.createdAt));
}

/**
 * Новое крыло. Первое крыло пилота — сразу по умолчанию: иначе новые полёты
 * остались бы без крыла, пока пилот не догадается нажать «основное».
 * null — у пилота уже GLIDER.maxPerUser крыльев.
 */
export async function createGlider(db: Database, userId: string, input: GliderInput): Promise<GliderRecord | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ n: count() }).from(gliders).where(eq(gliders.userId, userId));
    const n = existing?.n ?? 0;
    if (n >= GLIDER.maxPerUser) return null;
    const isDefault = input.isDefault || n === 0;
    if (isDefault) await tx.update(gliders).set({ isDefault: false }).where(eq(gliders.userId, userId));
    const [row] = await tx
      .insert(gliders)
      .values({ ...input, isDefault, userId })
      .returning(RECORD_COLUMNS);
    if (!row) throw new Error('glider insert returned no row');
    return row;
  });
}

/** null — крыла нет или оно чужое. Снять «по умолчанию» можно, только выбрав другое. */
export async function updateGlider(
  db: Database,
  userId: string,
  id: string,
  input: GliderInput,
): Promise<GliderRecord | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ isDefault: gliders.isDefault }).from(gliders).where(mine(userId, id));
    if (!current) return null;
    const isDefault = input.isDefault || current.isDefault;
    if (isDefault && !current.isDefault) {
      await tx.update(gliders).set({ isDefault: false }).where(eq(gliders.userId, userId));
    }
    const [row] = await tx
      .update(gliders)
      .set({ ...input, isDefault })
      .where(mine(userId, id))
      .returning(RECORD_COLUMNS);
    return row ?? null;
  });
}

/** Полёты удалённого крыла остаются без крыла (FK on delete set null). */
export async function deleteGlider(db: Database, userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(gliders).where(mine(userId, id)).returning({ id: gliders.id });
  return rows.length > 0;
}

export type SetFlightGliderResult = 'ok' | 'flight_not_found' | 'glider_not_found';

/** Сменить крыло своего полёта; null — отвязать. Чужое крыло не подставить. */
export async function setFlightGlider(
  db: Database,
  args: { flightId: string; userId: string; gliderId: string | null },
): Promise<SetFlightGliderResult> {
  if (args.gliderId !== null) {
    const [glider] = await db.select({ id: gliders.id }).from(gliders).where(mine(args.userId, args.gliderId));
    if (!glider) return 'glider_not_found';
  }
  const rows = await db
    .update(flights)
    .set({ gliderId: args.gliderId, updatedAt: new Date() })
    .where(and(eq(flights.id, args.flightId), eq(flights.userId, args.userId)))
    .returning({ id: flights.id });
  return rows.length > 0 ? 'ok' : 'flight_not_found';
}
