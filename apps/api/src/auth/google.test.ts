import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { createGoogleOAuth, GOOGLE_OAUTH, type GoogleOAuth } from './google.js';

const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const REDIRECT_URI = 'https://skyline.example/api/v1/auth/oauth/google/callback';
const NOW = new Date(Date.UTC(2026, 8, 26, 12));
const EPOCH_S = Math.floor(NOW.getTime() / 1000);
const KID = 'test-key';

describe('Google OAuth', () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let jwk: JWK;
  let requests: { url: string; body: URLSearchParams }[];
  let idTokenClaims: Record<string, unknown>;
  let tokenStatus: number;
  let google: GoogleOAuth;

  const idToken = (claims: Record<string, unknown>) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: KID }).sign(privateKey);

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256' };
  });

  const setup = () => {
    requests = [];
    tokenStatus = 200;
    idTokenClaims = {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: '1234567890',
      email: 'Pilot@Gmail.com',
      email_verified: true,
      name: 'Асқар',
      picture: 'https://lh3.googleusercontent.com/a/photo',
      nonce: 'nonce-1',
      iat: EPOCH_S,
      exp: EPOCH_S + 3600,
    };
    google = createGoogleOAuth({
      clientId: CLIENT_ID,
      clientSecret: 'secret',
      jwks: createLocalJWKSet({ keys: [jwk] }),
      now: () => NOW,
      fetch: async (url, init) => {
        requests.push({ url: url as string, body: new URLSearchParams(init?.body as string) });
        return new Response(JSON.stringify({ id_token: await idToken(idTokenClaims) }), {
          status: tokenStatus,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
  };

  const exchange = () =>
    google.exchange({ code: 'code-1', codeVerifier: 'verifier-1', redirectUri: REDIRECT_URI, nonce: 'nonce-1' });

  it('адрес авторизации: code flow, PKCE S256, nonce, только openid email profile', () => {
    setup();
    const url = new URL(
      google.authorizeUrl({ state: 'state-1', codeChallenge: 'challenge-1', nonce: 'nonce-1', redirectUri: REDIRECT_URI }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_OAUTH.authorizeUrl);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      state: 'state-1',
      nonce: 'nonce-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
  });

  it('обмен кода: отправляет verifier, проверяет id_token и отдаёт личность', async () => {
    setup();
    expect(await exchange()).toEqual({
      provider: 'google',
      subject: '1234567890',
      email: 'Pilot@Gmail.com',
      displayName: 'Асқар',
      avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(GOOGLE_OAUTH.tokenUrl);
    expect(Object.fromEntries(requests[0]?.body ?? [])).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      code_verifier: 'verifier-1',
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: 'secret',
    });
  });

  it('неподтверждённый email не пускает: иначе чужой email привязался бы к чужому аккаунту', async () => {
    setup();
    idTokenClaims.email_verified = false;
    await expect(exchange()).rejects.toThrow(/email/);
  });

  it('чужой nonce, чужой aud, чужой issuer — отказ', async () => {
    for (const patch of [{ nonce: 'other' }, { aud: 'other-client' }, { iss: 'https://evil.example' }]) {
      setup();
      Object.assign(idTokenClaims, patch);
      await expect(exchange()).rejects.toThrow();
    }
  });

  it('ошибка на обмене кода — отказ', async () => {
    setup();
    tokenStatus = 400;
    await expect(exchange()).rejects.toThrow(/400/);
  });

  it('без имени и фото — null', async () => {
    setup();
    delete idTokenClaims.name;
    delete idTokenClaims.picture;
    expect(await exchange()).toMatchObject({ displayName: null, avatarUrl: null });
  });
});
