import { z } from 'zod';

import { SiteSummary } from './site-dto.js';

/**
 * Статистика сезона (задача 2.12, ТЗ §10 GET /logbook/stats): год — по местной
 * дате полёта (задача 2.14). Только обработанные полёты. Единицы — СИ.
 */

/** Сколько мест показывать в «топе». */
export const TOP_SITES_LIMIT = 5;
export const MONTHS_IN_YEAR = 12;

export const SeasonStatsQuery = z.object({
  /** Нет — последний год, в котором пилот летал. */
  year: z.coerce.number().int().min(1990).max(2100).optional(),
});
export type SeasonStatsQuery = z.infer<typeof SeasonStatsQuery>;

const Totals = z.object({
  flights: z.number().int().nonnegative(),
  /** Время в воздухе от взлёта до посадки, с. */
  airtimeS: z.number().int().nonnegative(),
  distanceM: z.number().int().nonnegative(),
  /** Сумма подъёмов всех полётов, м. */
  gainM: z.number().int().nonnegative(),
  /** Рекорды сезона; null — полётов нет. */
  maxAltM: z.number().int().nullable(),
  longestAirtimeS: z.number().int().nullable(),
  longestDistanceM: z.number().int().nullable(),
});

export const SeasonStatsResponse = z.object({
  /** null — пилот ещё не летал. */
  year: z.number().int().nullable(),
  /** Годы с полётами, новые первыми: для переключателя. */
  years: z.array(z.number().int()),
  totals: Totals,
  /** Ровно 12 месяцев, январь первым; месяц без полётов — нули. */
  byMonth: z
    .array(
      z.object({
        month: z.number().int().min(1).max(MONTHS_IN_YEAR),
        flights: z.number().int().nonnegative(),
        airtimeS: z.number().int().nonnegative(),
        distanceM: z.number().int().nonnegative(),
      }),
    )
    .length(MONTHS_IN_YEAR),
  topSites: z.array(SiteSummary.extend({ flights: z.number().int().positive(), airtimeS: z.number().int().nonnegative() })),
});
export type SeasonStatsResponse = z.infer<typeof SeasonStatsResponse>;
