import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../client.js';
import { oauthAccounts, sessions, users } from '../schema.js';
import {
  createSession,
  findUserProfile,
  revokeSession,
  rotateSession,
  signInWithOAuth,
  usernameBase,
  type OAuthIdentity,
} from './users.js';

const databaseUrl = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);
const HOUR_MS = 3_600_000;
const GRACE_MS = 30_000;

describe('usernameBase', () => {
  it('берёт локальную часть email в нижнем регистре', () => {
    expect(usernameBase('Asqar.Duisen@gmail.com')).toBe('asqar.duisen');
  });

  it('заменяет недопустимые символы и схлопывает повторы', () => {
    expect(usernameBase('ivan+xc  test@mail.ru')).toBe('ivan_xc_test');
  });

  it('слишком короткое — дополняет до «pilot-…»', () => {
    expect(usernameBase('a@b.kz')).toBe('pilot-a');
    expect(usernameBase('+++@b.kz')).toBe('pilot');
  });

  it('обрезает длинное', () => {
    expect(usernameBase(`${'x'.repeat(60)}@b.kz`)).toHaveLength(24);
  });
});

// Интеграционный: нужен поднятый docker compose и применённые миграции.
describe.runIf(Boolean(databaseUrl))('пользователи и сессии на живой БД', () => {
  let connection: DatabaseConnection;
  const createdUsers: string[] = [];

  const identity = (n: string, overrides: Partial<OAuthIdentity> = {}): OAuthIdentity => ({
    provider: 'google',
    subject: `sub-${RUN}-${n}`,
    email: `pilot-${RUN}-${n}@example.com`,
    displayName: `Pilot ${n}`,
    avatarUrl: `https://example.com/${n}.png`,
    ...overrides,
  });

  const signIn = async (id: OAuthIdentity) => {
    const result = await signInWithOAuth(connection.db, id);
    createdUsers.push(result.userId);
    return result;
  };

  beforeAll(() => {
    connection = createDatabase(databaseUrl ?? '');
  });
  afterAll(async () => {
    if (createdUsers.length > 0) await connection.db.delete(users).where(inArray(users.id, createdUsers));
    await connection.close();
  });

  describe('signInWithOAuth', () => {
    it('первый вход создаёт пользователя и привязывает учётку провайдера', async () => {
      const result = await signIn(identity('new'));
      expect(result.created).toBe(true);

      const profile = await findUserProfile(connection.db, result.userId);
      expect(profile).toEqual({
        id: result.userId,
        username: `pilot-${RUN}-new`,
        displayName: 'Pilot new',
        avatarUrl: 'https://example.com/new.png',
        locale: 'ru',
        units: 'metric',
      });
      const links = await connection.db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, result.userId));
      expect(links.map((l) => [l.provider, l.subject])).toEqual([['google', `sub-${RUN}-new`]]);
    });

    it('повторный вход по тому же subject — тот же пользователь, даже если email сменился', async () => {
      const first = await signIn(identity('again'));
      const second = await signInWithOAuth(
        connection.db,
        identity('again', { email: `changed-${RUN}@example.com`, displayName: 'Другое имя' }),
      );
      expect(second).toEqual({ userId: first.userId, created: false });
      // Имя, которое пользователь мог поменять у нас, провайдер не перетирает.
      expect((await findUserProfile(connection.db, first.userId))?.displayName).toBe('Pilot again');
    });

    it('новый subject с email существующего пользователя привязывается к нему', async () => {
      const first = await signIn(identity('link'));
      const second = await signInWithOAuth(connection.db, identity('link', { subject: `other-${RUN}` }));
      expect(second).toEqual({ userId: first.userId, created: false });
    });

    it('занятое имя получает числовой суффикс', async () => {
      const a = await signIn(identity('dup', { email: `same-${RUN}@a.example` }));
      const b = await signIn(identity('dup2', { email: `same-${RUN}@b.example` }));
      const c = await signIn(identity('dup3', { email: `same-${RUN}@c.example` }));
      const names = await Promise.all(
        [a, b, c].map(async (r) => (await findUserProfile(connection.db, r.userId))?.username),
      );
      expect(names).toEqual([`same-${RUN}`, `same-${RUN}-2`, `same-${RUN}-3`]);
    });
  });

  describe('сессии', () => {
    let userId: string;
    const now = new Date();
    const later = new Date(now.getTime() + HOUR_MS);
    const afterGrace = new Date(now.getTime() + 2 * GRACE_MS);
    const token = (n: string): string => `hash-${RUN}-${n}`;
    const rotate = (from: string, to: string, at: Date = now) =>
      rotateSession(connection.db, {
        tokenHash: token(from),
        next: { tokenHash: token(to), expiresAt: later },
        now: at,
        reuseGraceMs: GRACE_MS,
      });

    beforeAll(async () => {
      userId = (await signIn(identity('sessions'))).userId;
    });

    it('ротация: старый токен отозван, новый действует', async () => {
      await createSession(connection.db, { userId, tokenHash: token('a1'), expiresAt: later });
      expect(await rotate('a1', 'a2')).toEqual({ kind: 'rotated', userId });
      expect(await rotate('a2', 'a3')).toEqual({ kind: 'rotated', userId });
    });

    it('старый токен сразу после ротации — «stale»: соседняя вкладка, не кража', async () => {
      await createSession(connection.db, { userId, tokenHash: token('b1'), expiresAt: later });
      await rotate('b1', 'b2');
      expect(await rotate('b1', 'b3')).toEqual({ kind: 'stale' });
      // Сессия b2 жива.
      expect((await rotate('b2', 'b4')).kind).toBe('rotated');
    });

    it('повтор отозванного токена после окна — кража: гасятся все сессии пользователя', async () => {
      await createSession(connection.db, { userId, tokenHash: token('c1'), expiresAt: later });
      await rotate('c1', 'c2');
      expect(await rotate('c1', 'c3', afterGrace)).toEqual({ kind: 'reused' });

      const all = await connection.db.select().from(sessions).where(eq(sessions.userId, userId));
      expect(all.every((s) => s.revokedAt !== null)).toBe(true);
    });

    it('неизвестный и просроченный токены — invalid', async () => {
      expect(await rotate('nope', 'd9')).toEqual({ kind: 'invalid' });

      await createSession(connection.db, { userId, tokenHash: token('d1'), expiresAt: new Date(now.getTime() - 1) });
      expect(await rotate('d1', 'd2')).toEqual({ kind: 'invalid' });
    });

    it('выход отзывает сессию; её токен потом — invalid, не кража', async () => {
      await createSession(connection.db, { userId, tokenHash: token('e1'), expiresAt: later });
      await createSession(connection.db, { userId, tokenHash: token('e-other'), expiresAt: later });
      await revokeSession(connection.db, token('e1'), now);
      expect(await rotate('e1', 'e2', afterGrace)).toEqual({ kind: 'invalid' });
      // Другие сессии пользователя выход не трогает.
      expect((await rotate('e-other', 'e3')).kind).toBe('rotated');
    });
  });

  it('findUserProfile — null для неизвестного id', async () => {
    expect(await findUserProfile(connection.db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
