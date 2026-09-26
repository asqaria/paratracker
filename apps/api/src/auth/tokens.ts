import { createHash, randomBytes } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

import { AUTH } from '../constants.js';

/**
 * Токены входа (задача 2.10). Access — JWT HS256 без состояния; refresh —
 * случайная строка, в БД только её хэш. Разные `aud` не дают подсунуть
 * запечатанное состояние OAuth вместо access-токена и наоборот.
 */

const ALGORITHM = 'HS256';
const ISSUER = 'skyline';
const AUDIENCE = { access: 'skyline:access', oauthState: 'skyline:oauth-state' } as const;
const MS_PER_SECOND = 1000;

const epochSeconds = (date: Date): number => Math.floor(date.getTime() / MS_PER_SECOND);

export async function signAccessToken(userId: string, secret: Uint8Array, now: Date): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE.access)
    .setSubject(userId)
    .setIssuedAt(epochSeconds(now))
    .setExpirationTime(epochSeconds(now) + AUTH.accessTokenTtlS)
    .sign(secret);
}

/** id пользователя; null — токен недействителен (просрочен, чужой, испорчен). */
export async function verifyAccessToken(token: string, secret: Uint8Array, now: Date): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE.access,
      currentDate: now,
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/** Незавершённый вход через провайдера: живёт в подписанной cookie до callback. */
export const OAuthState = z.object({
  state: z.string().min(1),
  codeVerifier: z.string().min(1),
  nonce: z.string().min(1),
  returnTo: z.string(),
});
export type OAuthState = z.infer<typeof OAuthState>;

export async function sealOAuthState(state: OAuthState, secret: Uint8Array, now: Date): Promise<string> {
  return new SignJWT({ ...state })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE.oauthState)
    .setIssuedAt(epochSeconds(now))
    .setExpirationTime(epochSeconds(now) + AUTH.oauthStateTtlS)
    .sign(secret);
}

export async function openOAuthState(sealed: string, secret: Uint8Array, now: Date): Promise<OAuthState | null> {
  try {
    const { payload } = await jwtVerify(sealed, secret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE.oauthState,
      currentDate: now,
    });
    const parsed = OAuthState.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const newRandomToken = (): string => randomBytes(AUTH.tokenBytes).toString('base64url');

/** SHA-256 без соли: токен сам случайный на 256 бит, перебор бессмыслен. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('base64url');

/** PKCE S256 (RFC 7636 §4.2). */
export const pkceChallenge = (verifier: string): string => hashToken(verifier);
