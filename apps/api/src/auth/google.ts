import type { OAuthIdentity } from '@skyline/db';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

/**
 * Вход через Google: OAuth 2.0 authorization code + PKCE, личность — из
 * id_token (OpenID Connect). Токены Google дальше обмена не живут: API
 * Google от имени пользователя мы не вызываем.
 */

/**
 * Адреса из discovery-документа Google
 * (https://accounts.google.com/.well-known/openid-configuration).
 * Это протокол, а не тайл-сервер: в конфиг не выносятся.
 */
export const GOOGLE_OAUTH = {
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
  /** Google подписывает id_token любым из двух вариантов issuer. */
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
  /** Только личность: email, имя, фото. */
  scope: 'openid email profile',
} as const;

export interface GoogleOAuth {
  authorizeUrl(params: { state: string; codeChallenge: string; nonce: string; redirectUri: string }): string;
  /** Бросает, если код, подпись, nonce или email не прошли проверку. */
  exchange(params: { code: string; codeVerifier: string; redirectUri: string; nonce: string }): Promise<OAuthIdentity>;
}

export interface GoogleOAuthOptions {
  clientId: string;
  clientSecret: string;
  /** Для тестов: локальные ключи и подменённая сеть. */
  jwks?: JWTVerifyGetKey;
  fetch?: typeof fetch;
  now?: () => Date;
}

const TokenResponse = z.object({ id_token: z.string().min(1) });

const IdTokenClaims = z.object({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.boolean(),
  nonce: z.string(),
  name: z.string().optional(),
  picture: z.url().optional(),
});

export function createGoogleOAuth(options: GoogleOAuthOptions): GoogleOAuth {
  const jwks = options.jwks ?? createRemoteJWKSet(new URL(GOOGLE_OAUTH.jwksUrl));
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    authorizeUrl({ state, codeChallenge, nonce, redirectUri }) {
      const url = new URL(GOOGLE_OAUTH.authorizeUrl);
      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_OAUTH.scope,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        // Показать выбор аккаунта: на общем компьютере иначе молча войдёт чужой.
        prompt: 'select_account',
      }).toString();
      return url.toString();
    },

    async exchange({ code, codeVerifier, redirectUri, nonce }) {
      const response = await doFetch(GOOGLE_OAUTH.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          client_id: options.clientId,
          client_secret: options.clientSecret,
        }).toString(),
      });
      if (!response.ok) throw new Error(`Google token endpoint answered ${response.status}`);
      const { id_token: idToken } = TokenResponse.parse(await response.json());

      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: [...GOOGLE_OAUTH.issuers],
        audience: options.clientId,
        currentDate: now(),
      });
      const claims = IdTokenClaims.parse(payload);
      if (claims.nonce !== nonce) throw new Error('id_token nonce mismatch');
      // По неподтверждённому email нельзя ни создавать, ни привязывать аккаунт.
      if (!claims.email_verified) throw new Error('Google email is not verified');

      return {
        provider: 'google',
        subject: claims.sub,
        email: claims.email,
        displayName: claims.name ?? null,
        avatarUrl: claims.picture ?? null,
      };
    },
  };
}
