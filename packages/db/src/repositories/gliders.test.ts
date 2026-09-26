import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { flights, users } from '../schema.js';
import { insertFlight } from './flights.js';
import { createGlider, deleteGlider, listGliders, setFlightGlider, updateGlider } from './gliders.js';
import { claimFlights } from './logbook.js';

const databaseUrl = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);

const RUSH = { manufacturer: 'Ozone', model: 'Rush 6', size: 'ML', certification: 'EN-B', isDefault: false } as const;
const BONANZA = { manufacturer: 'Gin', model: 'Bonanza 3', size: null, certification: 'EN-B', isDefault: false } as const;

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('крылья на живой БД', () => {
  let connection: DatabaseConnection;
  let pilot: string;
  let other: string;
  const createdUsers: string[] = [];
  const createdFlights: string[] = [];

  const user = async (name: string): Promise<string> => {
    const [row] = await connection.db
      .insert(users)
      .values({ email: `${name}-${RUN}@example.com`, username: `${name}-${RUN}` })
      .returning({ id: users.id });
    if (!row) throw new Error('user insert returned no row');
    createdUsers.push(row.id);
    return row.id;
  };
  const flight = async (userId: string | null, claimTokenHash?: string) => {
    const row = await insertFlight(connection.db, {
      userId,
      sourceFormat: 'igc',
      rawObjectKey: `raw/test/${RUN}-${createdFlights.length}.igc.gz`,
      ...(claimTokenHash === undefined ? {} : { claimTokenHash }),
    });
    createdFlights.push(row.id);
    return row.id;
  };
  const gliderOf = async (flightId: string) =>
    (await connection.db.select({ id: flights.gliderId }).from(flights).where(eq(flights.id, flightId)))[0]?.id;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    pilot = await user('gliders');
    other = await user('gliders-other');
  });
  afterAll(async () => {
    if (createdFlights.length > 0) await connection.db.delete(flights).where(inArray(flights.id, createdFlights));
    if (createdUsers.length > 0) await connection.db.delete(users).where(inArray(users.id, createdUsers));
    await connection.close();
  });

  it('первое крыло — сразу по умолчанию; новое основное снимает флаг со старого', async () => {
    const rush = await createGlider(connection.db, pilot, RUSH);
    expect(rush).toMatchObject({ ...RUSH, isDefault: true });

    const bonanza = await createGlider(connection.db, pilot, { ...BONANZA, isDefault: true });
    const list = await listGliders(connection.db, pilot);
    expect(list.map((g) => [g.model, g.isDefault])).toEqual([
      ['Bonanza 3', true],
      ['Rush 6', false],
    ]);
    expect(bonanza?.isDefault).toBe(true);
    expect(await listGliders(connection.db, other)).toEqual([]);
  });

  it('новый полёт вошедшего получает крыло по умолчанию; анонимный — нет; забранный — получает', async () => {
    const [bonanza] = await listGliders(connection.db, pilot);
    expect(await gliderOf(await flight(pilot))).toBe(bonanza?.id);
    expect(await gliderOf(await flight(other))).toBeNull();

    const anonymous = await flight(null, `hash-${RUN}`);
    expect(await gliderOf(anonymous)).toBeNull();
    await claimFlights(connection.db, pilot, [{ flightId: anonymous, tokenHash: `hash-${RUN}` }]);
    expect(await gliderOf(anonymous)).toBe(bonanza?.id);
  });

  it('смена крыла полёта: только своё крыло и только свой полёт', async () => {
    const [, rush] = await listGliders(connection.db, pilot);
    const mine = await flight(pilot);
    const foreignFlight = await flight(other);
    const foreignGlider = await createGlider(connection.db, other, RUSH);

    expect(await setFlightGlider(connection.db, { flightId: mine, userId: pilot, gliderId: rush?.id ?? '' })).toBe('ok');
    expect(await gliderOf(mine)).toBe(rush?.id);
    expect(
      await setFlightGlider(connection.db, { flightId: mine, userId: pilot, gliderId: foreignGlider?.id ?? '' }),
    ).toBe('glider_not_found');
    expect(
      await setFlightGlider(connection.db, { flightId: foreignFlight, userId: pilot, gliderId: rush?.id ?? '' }),
    ).toBe('flight_not_found');
    expect(await setFlightGlider(connection.db, { flightId: mine, userId: pilot, gliderId: null })).toBe('ok');
    expect(await gliderOf(mine)).toBeNull();
  });

  it('правка: чужое не меняется; «по умолчанию» переходит, но не снимается просто так', async () => {
    const [bonanza, rush] = await listGliders(connection.db, pilot);
    expect(await updateGlider(connection.db, other, rush?.id ?? '', RUSH)).toBeNull();

    const renamed = await updateGlider(connection.db, pilot, bonanza?.id ?? '', { ...BONANZA, size: 'M', isDefault: false });
    expect(renamed).toMatchObject({ size: 'M', isDefault: true });

    await updateGlider(connection.db, pilot, rush?.id ?? '', { ...RUSH, isDefault: true });
    expect((await listGliders(connection.db, pilot)).map((g) => [g.model, g.isDefault])).toEqual([
      ['Rush 6', true],
      ['Bonanza 3', false],
    ]);
  });

  it('удаление: полёты остаются без крыла; чужое не удаляется', async () => {
    const [rush] = await listGliders(connection.db, pilot);
    const withRush = await flight(pilot);
    expect(await gliderOf(withRush)).toBe(rush?.id);

    expect(await deleteGlider(connection.db, other, rush?.id ?? '')).toBe(false);
    expect(await deleteGlider(connection.db, pilot, rush?.id ?? '')).toBe(true);
    expect(await gliderOf(withRush)).toBeNull();
  });
});
