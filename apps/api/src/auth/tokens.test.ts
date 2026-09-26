import { describe, expect, it } from 'vitest';

import { AUTH } from '../constants.js';
import {
  hashToken,
  newRandomToken,
  openOAuthState,
  pkceChallenge,
  sealOAuthState,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';

const SECRET = new TextEncoder().encode('test-secret-that-is-at-least-32-bytes!');
const OTHER_SECRET = new TextEncoder().encode('another-secret-that-is-32-bytes-long!!');
const USER_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date(Date.UTC(2026, 8, 26, 12));
const at = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);

describe('access-токен', () => {
  it('подписанный токен даёт id пользователя', async () => {
    const token = await signAccessToken(USER_ID, SECRET, NOW);
    expect(await verifyAccessToken(token, SECRET, at(60))).toBe(USER_ID);
  });

  it('просроченный, чужой подписи и мусор — null, без исключений', async () => {
    const token = await signAccessToken(USER_ID, SECRET, NOW);
    expect(await verifyAccessToken(token, SECRET, at(AUTH.accessTokenTtlS + 1))).toBeNull();
    expect(await verifyAccessToken(token, OTHER_SECRET, at(60))).toBeNull();
    expect(await verifyAccessToken('not.a.jwt', SECRET, NOW)).toBeNull();
  });

  it('состояние входа OAuth нельзя подсунуть вместо access-токена', async () => {
    const sealed = await sealOAuthState(
      { state: 's', codeVerifier: 'v', nonce: 'n', returnTo: '#/' },
      SECRET,
      NOW,
    );
    expect(await verifyAccessToken(sealed, SECRET, NOW)).toBeNull();
  });
});

describe('состояние входа OAuth', () => {
  const payload = { state: 'state-1', codeVerifier: 'verifier-1', nonce: 'nonce-1', returnTo: '#/flight/x' };

  it('запечатывается и читается обратно', async () => {
    const sealed = await sealOAuthState(payload, SECRET, NOW);
    expect(await openOAuthState(sealed, SECRET, at(60))).toEqual(payload);
  });

  it('просроченное или access-токен — null', async () => {
    const sealed = await sealOAuthState(payload, SECRET, NOW);
    expect(await openOAuthState(sealed, SECRET, at(AUTH.oauthStateTtlS + 1))).toBeNull();
    expect(await openOAuthState(await signAccessToken(USER_ID, SECRET, NOW), SECRET, NOW)).toBeNull();
  });
});

describe('случайные токены', () => {
  it('256 бит в base64url, каждый раз новый', () => {
    const a = newRandomToken();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(newRandomToken()).not.toBe(a);
  });

  it('хэш — SHA-256 в base64url, детерминированный', () => {
    expect(hashToken('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });

  it('PKCE S256 — пример из RFC 7636, приложение B', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});
