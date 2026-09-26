import { z } from 'zod';

import { SITE } from './constants.js';
import { SiteSource } from './site.js';

/** Контракт мест старта (задача 2.13). */

/** Место в карточке полёта и строке логбука. */
export const SiteSummary = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  /** ISO 3166-1 alpha-2, строчными; null — неизвестна. */
  countryCode: z.string().length(2).nullable(),
  /** seed — из paragliding.earth: рядом с названием нужна атрибуция (CC BY-SA). */
  source: SiteSource,
});
export type SiteSummary = z.infer<typeof SiteSummary>;

/** POST /api/v1/sites — пилот добавляет место старта своего полёта. Точка — взлёт полёта. */
export const CreateSiteRequest = z.object({
  flightId: z.uuid(),
  name: z.string().trim().min(SITE.nameMinLength).max(SITE.nameMaxLength),
});
export type CreateSiteRequest = z.infer<typeof CreateSiteRequest>;

/** GET /api/v1/logbook/sites — места, откуда летал пилот: для фильтра логбука. */
export const LogbookSitesResponse = z.object({
  sites: z.array(SiteSummary.extend({ flightCount: z.number().int().positive() })),
});
export type LogbookSitesResponse = z.infer<typeof LogbookSitesResponse>;
