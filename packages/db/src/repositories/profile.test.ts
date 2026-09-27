import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { flights, users } from '../schema.js';
import { insertFlight } from './flights.js';
import { listLogbook } from './logbook.js';
import { findPublicProfile, updateUserProfile } from './users.js';

const databaseUrl = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('публичный профиль и его настройки (задача 3.11) на живой БД', () => {
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

  /** Готовый полёт пилота с заданной видимостью и цифрами. */
  const flight = async (
    userId: string,
    privacy: 'public' | 'unlisted' | 'private',
    numbers: { airtimeS: number; distanceTrackM: number; maxAltM: number; xcScore: number | null },
  ): Promise<string> => {
    const created = await insertFlight(connection.db, {
      userId,
      sourceFormat: 'igc',
      rawObjectKey: `raw/test/${RUN}-${createdFlights.length}.igc.gz`,
    });
    createdFlights.push(created.id);
    await connection.db
      .update(flights)
      .set({ privacy, status: 'ready', startedAt: new Date(Date.UTC(2005, 5, createdFlights.length)), ...numbers })
      .where(eq(flights.id, created.id));
    return created.id;
  };

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    pilot = await user('profile');
    other = await user('profile-other');
  });
  afterAll(async () => {
    if (createdFlights.length > 0) await connection.db.delete(flights).where(inArray(flights.id, createdFlights));
    if (createdUsers.length > 0) await connection.db.delete(users).where(inArray(users.id, createdUsers));
    await connection.close();
  });

  it('имя, адрес и видимость по умолчанию меняются; пустой патч — профиль как есть', async () => {
    const result = await updateUserProfile(connection.db, pilot, {
      displayName: 'Асқар',
      username: `asqar-${RUN}`,
      defaultPrivacy: 'public',
    });
    expect(result).toMatchObject({
      kind: 'ok',
      profile: { displayName: 'Асқар', username: `asqar-${RUN}`, defaultPrivacy: 'public' },
    });
    expect((await updateUserProfile(connection.db, pilot, {})).kind).toBe('ok');
  });

  it('занятый адрес — taken, в том числе в другом регистре', async () => {
    expect(await updateUserProfile(connection.db, other, { username: `asqar-${RUN}` })).toEqual({ kind: 'taken' });
    expect((await updateUserProfile(connection.db, '00000000-0000-4000-8000-000000000000', { displayName: 'x' })).kind).toBe(
      'not_found',
    );
  });

  it('новый полёт получает видимость из настроек пилота', async () => {
    const created = await insertFlight(connection.db, {
      userId: pilot,
      sourceFormat: 'igc',
      rawObjectKey: `raw/test/${RUN}-default.igc.gz`,
    });
    createdFlights.push(created.id);
    expect(created.privacy).toBe('public');
    const anonymous = await insertFlight(connection.db, {
      userId: null,
      sourceFormat: 'igc',
      rawObjectKey: `raw/test/${RUN}-anon.igc.gz`,
    });
    createdFlights.push(anonymous.id);
    expect(anonymous.privacy).toBe('unlisted');
  });

  it('итоги и список профиля — только по полётам «Все»', async () => {
    const shown = await flight(pilot, 'public', { airtimeS: 3600, distanceTrackM: 40_000, maxAltM: 3000, xcScore: 55.5 });
    const shown2 = await flight(pilot, 'public', { airtimeS: 1800, distanceTrackM: 10_000, maxAltM: 2500, xcScore: null });
    await flight(pilot, 'unlisted', { airtimeS: 36_000, distanceTrackM: 400_000, maxAltM: 5000, xcScore: 300 });
    await flight(pilot, 'private', { airtimeS: 36_000, distanceTrackM: 400_000, maxAltM: 5000, xcScore: 300 });

    const profile = await findPublicProfile(connection.db, `ASQAR-${RUN}`);
    expect(profile?.totals).toEqual({
      flights: 2,
      airtimeS: 5400,
      distanceM: 50_000,
      maxAltM: 3000,
      longestAirtimeS: 3600,
      longestDistanceM: 40_000,
      bestXcScore: 55.5,
    });
    const list = await listLogbook(connection.db, { userId: pilot, limit: 10, publicOnly: true });
    expect(list.items.map((item) => item.id).sort()).toEqual([shown, shown2].sort());
    expect(await findPublicProfile(connection.db, `nobody-${RUN}`)).toBeNull();
  });
});
