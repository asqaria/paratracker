import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { flights, users } from '../schema.js';
import { addComment, deleteComment, findComment, listComments } from './comments.js';
import { insertFlight } from './flights.js';
import { listFeed } from './social.js';

const databaseUrl = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);
const FUTURE = Date.UTC(2098, 0, 1) + (Date.now() % 1_000_000);

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('комментарии к полёту (задача 3.10б) на живой БД', () => {
  let connection: DatabaseConnection;
  let pilot: string;
  let coach: string;
  let flightId: string;
  const createdUsers: string[] = [];

  const user = async (name: string): Promise<string> => {
    const [row] = await connection.db
      .insert(users)
      .values({ email: `${name}-${RUN}@example.com`, username: `${name}-${RUN}`, displayName: `Пилот ${name}` })
      .returning({ id: users.id });
    if (!row) throw new Error('user insert returned no row');
    createdUsers.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    connection = createDatabase(databaseUrl ?? '');
    pilot = await user('comments-pilot');
    coach = await user('comments-coach');
    const flight = await insertFlight(connection.db, { userId: pilot, sourceFormat: 'igc', rawObjectKey: `raw/test/${RUN}.igc.gz` });
    flightId = flight.id;
    await connection.db
      .update(flights)
      .set({ privacy: 'public', status: 'ready', airtimeS: 1800, startedAt: new Date(FUTURE) })
      .where(eq(flights.id, flightId));
  });
  afterAll(async () => {
    await connection.db.delete(flights).where(eq(flights.id, flightId));
    await connection.db.delete(users).where(inArray(users.id, createdUsers));
    await connection.close();
  });

  it('по времени, с автором и моментом полёта; ответ — со ссылкой на родителя', async () => {
    const root = await addComment(connection.db, { flightId, userId: coach, parentId: null, body: 'Здесь ушёл из термика', timecodeS: 5020 });
    const reply = await addComment(connection.db, { flightId, userId: pilot, parentId: root, body: 'А куда надо было?', timecodeS: null });
    const list = await listComments(connection.db, flightId);
    expect(list.map((c) => [c.id, c.parentId, c.body, c.timecodeS])).toEqual([
      [root, null, 'Здесь ушёл из термика', 5020],
      [reply, root, 'А куда надо было?', null],
    ]);
    expect(list[0]?.author).toMatchObject({ username: `comments-coach-${RUN}`, displayName: 'Пилот comments-coach' });
    expect(await findComment(connection.db, reply)).toMatchObject({ flightId, userId: pilot, parentId: root, deleted: false });
  });

  it('удалённый с ответами — плашка без текста; ушёл последний ответ — уходит и она', async () => {
    const [root, reply] = await listComments(connection.db, flightId);
    await deleteComment(connection.db, root?.id ?? '');
    const afterRoot = await listComments(connection.db, flightId);
    expect(afterRoot.map((c) => c.body)).toEqual([null, 'А куда надо было?']);
    await deleteComment(connection.db, reply?.id ?? '');
    expect(await listComments(connection.db, flightId)).toEqual([]);
    expect(await findComment(connection.db, root?.id ?? '')).toBeNull();
  });

  it('в ленте — число живых комментариев', async () => {
    await addComment(connection.db, { flightId, userId: coach, parentId: null, body: 'Хороший полёт', timecodeS: null });
    const page = await listFeed(connection.db, { viewerId: null, scope: 'all', limit: 50 });
    expect(page.items.find((item) => item.flightId === flightId)?.commentCount).toBe(1);
  });
});
