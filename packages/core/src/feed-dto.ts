import { z } from 'zod';

/**
 * Лента, лайки и подписки (задача 3.10а, ТЗ §10). В ленте — только полёты «Все»:
 * «Подписки» — тех, на кого подписан вошедший, «Все» — всех пилотов.
 */

export const FEED_SCOPES = ['following', 'all'] as const;
export const FeedScope = z.enum(FEED_SCOPES);
export type FeedScope = z.infer<typeof FeedScope>;

/** Страница ленты: карточка с картинкой тяжелее строки логбука — страницы меньше. */
export const FEED_PAGE = {
  defaultLimit: 20,
  maxLimit: 50,
} as const;

export const FeedQuery = z.object({
  scope: FeedScope.default('all'),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(FEED_PAGE.maxLimit).default(FEED_PAGE.defaultLimit),
});
export type FeedQuery = z.infer<typeof FeedQuery>;

/** Пилот в карточке ленты: ссылка на профиль /u/{username}. */
export const FeedPilot = z.object({
  username: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.url().nullable(),
});
export type FeedPilot = z.infer<typeof FeedPilot>;

export const FeedItem = z.object({
  flightId: z.uuid(),
  pilot: FeedPilot,
  /** Старт записи, ISO 8601 UTC; дата в карточке — местная (timezone). */
  startedAt: z.iso.datetime().nullable(),
  timezone: z.string().nullable(),
  siteName: z.string().nullable(),
  airtimeS: z.number().int().nonnegative().nullable(),
  distanceTrackM: z.number().int().nonnegative().nullable(),
  maxAltM: z.number().int().nullable(),
  xcScore: z.number().nullable(),
  likeCount: z.number().int().nonnegative(),
  /** Вошедший уже лайкнул; у анонима — false. */
  likedByMe: z.boolean(),
  /** Есть картинка-превью (задача 3.8): GET /flights/{id}/preview.jpg. */
  hasPreview: z.boolean(),
});
export type FeedItem = z.infer<typeof FeedItem>;

export const FeedResponse = z.object({
  items: z.array(FeedItem),
  nextCursor: z.string().nullable(),
});
export type FeedResponse = z.infer<typeof FeedResponse>;

/** Ответ POST/DELETE /flights/{id}/like: состояние после действия. */
export const LikeResponse = z.object({
  liked: z.boolean(),
  likeCount: z.number().int().nonnegative(),
});
export type LikeResponse = z.infer<typeof LikeResponse>;

/** Ответ POST/DELETE /users/{username}/follow. */
export const FollowResponse = z.object({
  following: z.boolean(),
  followers: z.number().int().nonnegative(),
});
export type FollowResponse = z.infer<typeof FollowResponse>;
