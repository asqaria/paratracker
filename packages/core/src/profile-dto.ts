import { z } from 'zod';

import { Privacy } from './user.js';

/**
 * Публичный профиль пилота (задача 3.11, ТЗ §8.2 /u/:username) и его настройки.
 * В профиле — только полёты «Все» (решение владельца 27.09.2026): ни список,
 * ни цифры не выдают полёты «По ссылке» и «Только я» даже в сумме.
 */

/** Правила имени пользователя — адреса профиля /u/{имя}. */
export const USERNAME = {
  /** Короче — не узнать в ленте; длиннее — не влезает в карточку. */
  minLength: 3,
  maxLength: 24,
  /**
   * Строчные латинские буквы, цифры и . _ - внутри: имя — часть адреса,
   * и одно имя не должно выглядеть двумя (регистр) или ломать ссылку.
   */
  pattern: /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/,
  /** Когда из email не вышло ничего осмысленного. */
  fallback: 'pilot',
} as const;

export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .min(USERNAME.minLength)
  .max(USERNAME.maxLength)
  .regex(USERNAME.pattern);

/** Отображаемое имя: как пилот хочет, чтобы его звали в ленте и сравнении. */
export const DISPLAY_NAME_MAX_LENGTH = 60;

/** PATCH /api/v1/me: что пилот меняет в настройках. null у имени — вернуть логин. */
export const ProfilePatch = z
  .object({
    displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH).nullable().optional(),
    username: Username.optional(),
    /** Видимость новых полётов (загрузка и перенос анонимных). */
    defaultPrivacy: Privacy.optional(),
  })
  .strict();
export type ProfilePatch = z.infer<typeof ProfilePatch>;

/** Итоги по публичным полётам — всё время, не сезон. */
export const ProfileTotals = z.object({
  flights: z.number().int().nonnegative(),
  airtimeS: z.number().int().nonnegative(),
  distanceM: z.number().int().nonnegative(),
  maxAltM: z.number().int().nullable(),
  longestAirtimeS: z.number().int().nullable(),
  longestDistanceM: z.number().int().nullable(),
  /** Лучшие XC-очки; null — полётов с очками нет. */
  bestXcScore: z.number().nullable(),
});
export type ProfileTotals = z.infer<typeof ProfileTotals>;

/** GET /api/v1/users/{username}. Email и настройки наружу не отдаём. */
export const PublicProfileResponse = z.object({
  username: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.url().nullable(),
  /** Когда зарегистрировался, ISO 8601 UTC. */
  memberSince: z.iso.datetime(),
  totals: ProfileTotals,
  /** Подписчики и подписки (задача 3.10а). */
  followers: z.number().int().nonnegative(),
  following: z.number().int().nonnegative(),
  /** Вошедший подписан на этого пилота; у анонима и у себя — false. */
  followedByMe: z.boolean(),
});
export type PublicProfileResponse = z.infer<typeof PublicProfileResponse>;
