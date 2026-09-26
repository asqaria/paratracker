import type { AuthProvider, Locale, UnitSystem } from '@skyline/core';
import { and, eq, isNull, like, or } from 'drizzle-orm';

import type { Database } from '../client.js';
import { oauthAccounts, sessions, users } from '../schema.js';

/**
 * Пользователи и сессии (задача 2.10). Вход — только через OAuth: паролей нет.
 * Токены сюда приходят уже хэшированными — сырой refresh-токен БД не видит.
 */

/** Кто вошёл, по данным провайдера. Email — подтверждённый: проверяет вызывающий. */
export interface OAuthIdentity {
  provider: AuthProvider;
  subject: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  locale: Locale;
  units: UnitSystem;
}

export interface NewSession {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export type RotateResult =
  | { kind: 'rotated'; userId: string }
  /** Токен только что сменили в соседней вкладке: повторить запрос с новой cookie. */
  | { kind: 'stale' }
  /** Повтор давно сменённого токена — его украли; все сессии пользователя погашены. */
  | { kind: 'reused' }
  /** Неизвестен, просрочен или отозван выходом. */
  | { kind: 'invalid' };

const USERNAME = {
  /** Короче — не узнать в ленте; длиннее — не влезает в карточку. */
  minLength: 3,
  maxLength: 24,
  /** Когда из email не вышло ничего осмысленного. */
  fallback: 'pilot',
  /** Сколько раз переподбирать имя, если его заняли между проверкой и вставкой. */
  insertAttempts: 3,
} as const;

/** Postgres: нарушение UNIQUE. */
const UNIQUE_VIOLATION = '23505';

/** Имя пользователя из email: локальная часть, только [a-z0-9._-]. */
export function usernameBase(email: string): string {
  const local = email.split('@')[0] ?? '';
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, USERNAME.maxLength);
  if (cleaned.length === 0) return USERNAME.fallback;
  return cleaned.length < USERNAME.minLength ? `${USERNAME.fallback}-${cleaned}` : cleaned;
}

/** Свободное имя: base, иначе base-2, base-3, … — наименьший незанятый номер. */
async function freeUsername(db: Database, base: string): Promise<string> {
  const taken = await db
    .select({ username: users.username })
    .from(users)
    .where(or(eq(users.username, base), like(users.username, `${base}-%`)));
  const names = new Set(taken.map((row) => row.username.toLowerCase()));
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!names.has(candidate)) return candidate;
  }
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION;

/**
 * Вход через провайдера: найти по (provider, subject), иначе по email
 * (привязать новую учётку), иначе создать пользователя.
 */
export async function signInWithOAuth(
  db: Database,
  identity: OAuthIdentity,
): Promise<{ userId: string; created: boolean }> {
  const [linked] = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, identity.provider), eq(oauthAccounts.subject, identity.subject)));
  if (linked) {
    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, linked.userId));
    return { userId: linked.userId, created: false };
  }

  const link = { provider: identity.provider, subject: identity.subject };
  const [byEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, identity.email));
  if (byEmail) {
    await db.insert(oauthAccounts).values({ ...link, userId: byEmail.id }).onConflictDoNothing();
    return { userId: byEmail.id, created: false };
  }

  const base = usernameBase(identity.email);
  for (let attempt = 1; ; attempt++) {
    const username = await freeUsername(db, base);
    try {
      const userId = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            email: identity.email,
            username,
            displayName: identity.displayName,
            avatarUrl: identity.avatarUrl,
            lastSeenAt: new Date(),
          })
          .returning({ id: users.id });
        if (!user) throw new Error('user insert returned no row');
        await tx.insert(oauthAccounts).values({ ...link, userId: user.id });
        return user.id;
      });
      return { userId, created: true };
    } catch (error) {
      // Имя заняли между подбором и вставкой — подобрать заново.
      if (!isUniqueViolation(error) || attempt >= USERNAME.insertAttempts) throw error;
    }
  }
}

export async function findUserProfile(db: Database, id: string): Promise<UserProfile | null> {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      locale: users.locale,
      units: users.units,
    })
    .from(users)
    .where(eq(users.id, id));
  return row ?? null;
}

export async function createSession(db: Database, session: NewSession): Promise<void> {
  await db.insert(sessions).values(session);
}

/**
 * Ротация refresh-токена. Старая сессия отзывается и ссылается на новую.
 * Повтор уже сменённого токена в пределах reuseGraceMs — соседняя вкладка
 * успела раньше (cookie общая), позже — кража.
 */
export async function rotateSession(
  db: Database,
  args: { tokenHash: string; next: { tokenHash: string; expiresAt: Date }; now: Date; reuseGraceMs: number },
): Promise<RotateResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, args.tokenHash))
      .for('update');
    if (!current || current.expiresAt <= args.now) return { kind: 'invalid' };

    if (current.revokedAt !== null) {
      // Отозвана выходом или гашением после кражи — просто нет сессии.
      if (current.replacedBy === null) return { kind: 'invalid' };
      if (args.now.getTime() - current.revokedAt.getTime() <= args.reuseGraceMs) return { kind: 'stale' };
      await tx
        .update(sessions)
        .set({ revokedAt: args.now })
        .where(and(eq(sessions.userId, current.userId), isNull(sessions.revokedAt)));
      return { kind: 'reused' };
    }

    const [next] = await tx
      .insert(sessions)
      .values({ userId: current.userId, tokenHash: args.next.tokenHash, expiresAt: args.next.expiresAt })
      .returning({ id: sessions.id });
    await tx.update(sessions).set({ revokedAt: args.now, replacedBy: next?.id ?? null }).where(eq(sessions.id, current.id));
    await tx.update(users).set({ lastSeenAt: args.now }).where(eq(users.id, current.userId));
    return { kind: 'rotated', userId: current.userId };
  });
}

/** Выход: отозвать сессию. Неизвестный токен — не ошибка. */
export async function revokeSession(db: Database, tokenHash: string, now: Date): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}
