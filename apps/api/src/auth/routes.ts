import cookie from '@fastify/cookie';
import { AuthProvidersResponse, MeResponse, safeReturnTo } from '@skyline/core';
import type { NewSession, OAuthIdentity, RotateResult, UserProfile } from '@skyline/db';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { API_V1_PREFIX, AUTH } from '../constants.js';
import { problem, sendProblem } from '../problem.js';
import type { GoogleOAuth } from './google.js';
import {
  hashToken,
  newRandomToken,
  openOAuthState,
  pkceChallenge,
  sealOAuthState,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';

/**
 * Вход через Google, сессии и профиль (задача 2.10, ТЗ §10). Паролей нет.
 *
 * Cookie — httpOnly, SameSite=Lax: фронт и API на одном origin, чужой сайт
 * не пошлёт их ни в POST, ни в fetch. Access живёт 15 минут и отдаётся на
 * весь /api/v1; refresh — только на /api/v1/auth, чтобы не летать с каждым
 * запросом трека.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** Вошедший пользователь по access-cookie; null — аноним. */
    userId: string | null;
  }
}

export interface AuthDeps {
  jwtSecret: Uint8Array;
  /** Адрес сайта для браузера: redirect_uri, возврат после входа, флаг Secure. */
  publicUrl: string;
  /** null — вход через Google не настроен. */
  google: GoogleOAuth | null;
  users: {
    signIn(identity: OAuthIdentity): Promise<{ userId: string; created: boolean }>;
    profile(id: string): Promise<UserProfile | null>;
  };
  sessions: {
    create(session: NewSession): Promise<void>;
    rotate(args: {
      tokenHash: string;
      next: { tokenHash: string; expiresAt: Date };
      now: Date;
      reuseGraceMs: number;
    }): Promise<RotateResult>;
    revoke(tokenHash: string, now: Date): Promise<void>;
  };
  now?: () => Date;
}

const COOKIE = {
  access: { name: 'skyline_at', path: API_V1_PREFIX, maxAge: AUTH.accessTokenTtlS },
  refresh: { name: 'skyline_rt', path: `${API_V1_PREFIX}/auth`, maxAge: AUTH.refreshTokenTtlS },
  oauth: { name: 'skyline_oauth', path: `${API_V1_PREFIX}/auth/oauth`, maxAge: AUTH.oauthStateTtlS },
} as const;
type CookieSpec = (typeof COOKIE)[keyof typeof COOKIE];

const HTTP = { found: 302, noContent: 204, unauthorized: 401, conflict: 409, unavailable: 503 } as const;
const MS_PER_SECOND = 1000;
/** Хэш-маршрут фронта, где объясняют, что вход не удался (apps/web routing.ts). */
const AUTH_FAILED_ROUTE = '#/auth-failed';

const StartQuery = z.object({ returnTo: z.string().optional() });
/** Отказ пользователя приходит как ?error=…&state=… — без code, и схема его не пропустит. */
const CallbackQuery = z.object({ code: z.string().min(1), state: z.string().min(1) });

/** Вешает до маршрутов: request.userId нужен и загрузке полёта. */
export function registerAuthHook(app: FastifyInstance, deps: AuthDeps | undefined): void {
  app.decorateRequest('userId', null);
  if (!deps) return;
  const now = deps.now ?? (() => new Date());

  void app.register(cookie);
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[COOKIE.access.name];
    // Просроченный или чужой токен — просто аноним: фронт сам обновит сессию.
    request.userId = token ? await verifyAccessToken(token, deps.jwtSecret, now()) : null;
  });
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const now = deps.now ?? (() => new Date());
  const secure = new URL(deps.publicUrl).protocol === 'https:';
  const redirectUri = `${deps.publicUrl}${API_V1_PREFIX}/auth/oauth/google/callback`;

  const setCookie = (reply: FastifyReply, spec: CookieSpec, value: string): void => {
    reply.setCookie(spec.name, value, { path: spec.path, maxAge: spec.maxAge, httpOnly: true, secure, sameSite: 'lax' });
  };
  const clearCookie = (reply: FastifyReply, spec: CookieSpec): void => {
    reply.setCookie(spec.name, '', { path: spec.path, maxAge: 0, httpOnly: true, secure, sameSite: 'lax' });
  };
  const clearSession = (reply: FastifyReply): void => {
    clearCookie(reply, COOKIE.access);
    clearCookie(reply, COOKIE.refresh);
  };

  /** Выдать пару токенов; refresh в БД — только хэшем. */
  const issueTokens = async (reply: FastifyReply, userId: string, refreshToken: string): Promise<void> => {
    setCookie(reply, COOKIE.access, await signAccessToken(userId, deps.jwtSecret, now()));
    setCookie(reply, COOKIE.refresh, refreshToken);
  };
  const refreshExpiry = (): Date => new Date(now().getTime() + AUTH.refreshTokenTtlS * MS_PER_SECOND);

  app.get('/auth/providers', () => AuthProvidersResponse.parse({ google: deps.google !== null }));

  app.get('/auth/oauth/google', async (request, reply) => {
    if (!deps.google) {
      return sendProblem(reply, problem(HTTP.unavailable, { detail: 'Google sign-in is not configured' }));
    }
    const { returnTo } = StartQuery.parse(request.query);
    const state = newRandomToken();
    const codeVerifier = newRandomToken();
    const nonce = newRandomToken();
    const sealed = await sealOAuthState(
      { state, codeVerifier, nonce, returnTo: safeReturnTo(returnTo) },
      deps.jwtSecret,
      now(),
    );
    setCookie(reply, COOKIE.oauth, sealed);
    return reply.redirect(
      deps.google.authorizeUrl({ state, codeChallenge: pkceChallenge(codeVerifier), nonce, redirectUri }),
      HTTP.found,
    );
  });

  app.get('/auth/oauth/google/callback', async (request, reply) => {
    const fail = (reason: string, err?: unknown): FastifyReply => {
      request.log.info({ reason, err }, 'google sign-in failed');
      return reply.redirect(`${deps.publicUrl}/${AUTH_FAILED_ROUTE}`, HTTP.found);
    };
    // Состояние одноразовое: стираем при любом исходе.
    clearCookie(reply, COOKIE.oauth);
    if (!deps.google) return fail('not_configured');

    const query = CallbackQuery.safeParse(request.query);
    if (!query.success) return fail('bad_callback_query');
    const sealed = request.cookies[COOKIE.oauth.name];
    const pending = sealed ? await openOAuthState(sealed, deps.jwtSecret, now()) : null;
    if (!pending) return fail('no_pending_sign_in');
    // state из cookie против state из адреса — защита от подброшенного входа (CSRF).
    if (pending.state !== query.data.state) return fail('state_mismatch');

    let identity: OAuthIdentity;
    try {
      identity = await deps.google.exchange({
        code: query.data.code,
        codeVerifier: pending.codeVerifier,
        redirectUri,
        nonce: pending.nonce,
      });
    } catch (err) {
      return fail('exchange_failed', err);
    }

    const { userId, created } = await deps.users.signIn(identity);
    const refreshToken = newRandomToken();
    await deps.sessions.create({ userId, tokenHash: hashToken(refreshToken), expiresAt: refreshExpiry() });
    await issueTokens(reply, userId, refreshToken);
    request.log.info({ userId, created }, 'signed in with google');
    return reply.redirect(`${deps.publicUrl}/${safeReturnTo(pending.returnTo)}`, HTTP.found);
  });

  app.post('/auth/refresh', async (request, reply) => {
    const token = request.cookies[COOKIE.refresh.name];
    if (!token) return sendProblem(reply, problem(HTTP.unauthorized, { detail: 'No session' }));

    const nextToken = newRandomToken();
    const result = await deps.sessions.rotate({
      tokenHash: hashToken(token),
      next: { tokenHash: hashToken(nextToken), expiresAt: refreshExpiry() },
      now: now(),
      reuseGraceMs: AUTH.refreshReuseGraceS * MS_PER_SECOND,
    });

    if (result.kind === 'rotated') {
      await issueTokens(reply, result.userId, nextToken);
      return reply.code(HTTP.noContent).send();
    }
    if (result.kind === 'stale') {
      // Соседняя вкладка уже обновила cookie — повторить запрос, ничего не стирая.
      return sendProblem(reply, problem(HTTP.conflict, { detail: 'Session was just refreshed; retry' }));
    }
    if (result.kind === 'reused') request.log.warn('refresh token reuse: all sessions of the user revoked');
    clearSession(reply);
    return sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Session expired' }));
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[COOKIE.refresh.name];
    if (token) await deps.sessions.revoke(hashToken(token), now());
    clearSession(reply);
    return reply.code(HTTP.noContent).send();
  });

  app.get('/me', async (request, reply) => {
    const profile = request.userId ? await deps.users.profile(request.userId) : null;
    if (!profile) return sendProblem(reply, problem(HTTP.unauthorized, { detail: 'Not signed in' }));
    return reply.send(MeResponse.parse(profile));
  });
}
