import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { flights, users } from '../schema.js';
import { insertFlight } from './flights.js';
import { ensureShareToken, findSharedFlight, findSharePreview, resetShareToken, setFlightPrivacy } from './sharing.js';

const databaseUrl = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('приватность и ссылки полёта на живой БД', () => {
  let connection: DatabaseConnection;
  let pilot: string;
  let other: string;
  let flightId: string;
  const createdUsers: string[] = [];

  const user = async (name: string): Promise<string> => {
    const [row] = await connection.db
      .insert(users)
      .values({ email: `${name}-${RUN}@example.com`, username: `${name}-${RUN}` })
      .returning({ id: users.id });
    if (!row) throw new Error('user insert returned no row');
    createdUsers.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    pilot = await user('share');
    other = await user('share-other');
    const flight = await insertFlight(connection.db, { userId: pilot, sourceFormat: 'igc', rawObjectKey: `raw/test/${RUN}.igc.gz` });
    flightId = flight.id;
  });
  afterAll(async () => {
    await connection.db.delete(flights).where(eq(flights.id, flightId));
    await connection.db.delete(users).where(inArray(users.id, createdUsers));
    await connection.close();
  });

  it('новый полёт — «по ссылке», токена ещё нет', async () => {
    const [row] = await connection.db.select().from(flights).where(eq(flights.id, flightId));
    expect(row).toMatchObject({ privacy: 'unlisted', shareToken: null });
  });

  it('токен создаётся один раз; повторный запрос отдаёт тот же', async () => {
    expect(await ensureShareToken(connection.db, { flightId, userId: pilot, newToken: `a-${RUN}` })).toBe(`a-${RUN}`);
    expect(await ensureShareToken(connection.db, { flightId, userId: pilot, newToken: `b-${RUN}` })).toBe(`a-${RUN}`);
    expect(await findSharedFlight(connection.db, `a-${RUN}`)).toBe(flightId);
  });

  it('сброс: новый токен работает, старый — нет', async () => {
    expect(await resetShareToken(connection.db, { flightId, userId: pilot, newToken: `c-${RUN}` })).toBe(`c-${RUN}`);
    expect(await findSharedFlight(connection.db, `a-${RUN}`)).toBeNull();
    expect(await findSharedFlight(connection.db, `c-${RUN}`)).toBe(flightId);
  });

  it('карточка для мессенджера (задача 3.8): по действующему токену', async () => {
    await connection.db.update(flights).set({ previewObjectKey: `previews/${flightId}.jpg` }).where(eq(flights.id, flightId));
    expect(await findSharePreview(connection.db, `c-${RUN}`)).toMatchObject({
      flightId,
      previewObjectKey: `previews/${flightId}.jpg`,
      siteName: null,
      airtimeS: null,
    });
    expect(await findSharePreview(connection.db, `a-${RUN}`)).toBeNull();
  });

  it('«только я» — ссылка не открывает; чужой пилот ничего не меняет', async () => {
    expect(await setFlightPrivacy(connection.db, { flightId, userId: pilot, privacy: 'private' })).toBe(true);
    expect(await findSharedFlight(connection.db, `c-${RUN}`)).toBeNull();
    expect(await findSharePreview(connection.db, `c-${RUN}`)).toBeNull();

    expect(await setFlightPrivacy(connection.db, { flightId, userId: other, privacy: 'public' })).toBe(false);
    expect(await ensureShareToken(connection.db, { flightId, userId: other, newToken: 'x' })).toBeNull();
    expect(await resetShareToken(connection.db, { flightId, userId: other, newToken: 'x' })).toBeNull();
  });
});
