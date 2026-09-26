import { z } from 'zod';

import { FlightStatus } from './flight.js';
import { GliderSummary } from './glider.js';
import { SiteSummary } from './site-dto.js';

/**
 * Контракт логбука (задача 2.11, ТЗ §10): список своих полётов, карта всех
 * полётов и перенос анонимных загрузок в логбук после входа. Единицы — СИ.
 */

export const LOGBOOK_PAGE = {
  /** Столько строк помещается на экран-полтора: дальше — «ещё». */
  defaultLimit: 30,
  /** Потолок одной страницы: курсорная пагинация, а не выгрузка всего. */
  maxLimit: 100,
} as const;

/** GET /api/v1/logbook — фильтр по местной дате старта (задача 2.14), курсор, размер. */
export const LogbookQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  cursor: z.string().min(1).optional(),
  /** Только полёты с этого места старта (задача 2.13). */
  siteId: z.uuid().optional(),
  /** Только полёты на этом крыле (задача 2.13б). */
  gliderId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(LOGBOOK_PAGE.maxLimit).default(LOGBOOK_PAGE.defaultLimit),
});
export type LogbookQuery = z.infer<typeof LogbookQuery>;

/** Строка логбука. null — у полёта этого ещё нет (в обработке, упал, нет высоты). */
export const LogbookEntry = z.object({
  id: z.uuid(),
  status: FlightStatus,
  /** Старт полёта, ISO 8601 UTC; до обработки — null. */
  startedAt: z.iso.datetime().nullable(),
  /** Когда загружен, ISO 8601 UTC. */
  uploadedAt: z.iso.datetime(),
  /** IANA-таймзона места взлёта: дата в строке — местная (задача 2.14); null — не обработан. */
  timezone: z.string().nullable(),
  durationS: z.number().int().nonnegative().nullable(),
  distanceTrackM: z.number().int().nonnegative().nullable(),
  maxAltM: z.number().int().nullable(),
  thermalCount: z.number().int().nonnegative().nullable(),
  /** null — место не определено (нет рядом известного или полёт не обработан). */
  takeoffSite: SiteSummary.nullable(),
  glider: GliderSummary.nullable(),
});
export type LogbookEntry = z.infer<typeof LogbookEntry>;

export const LogbookResponse = z.object({
  items: z.array(LogbookEntry),
  /** Курсор следующей страницы; null — это последняя. */
  nextCursor: z.string().nullable(),
});
export type LogbookResponse = z.infer<typeof LogbookResponse>;

const Position = z.tuple([z.number(), z.number()]);

/** GET /api/v1/logbook/map — упрощённые треки в GeoJSON (RFC 7946: [долгота, широта]). */
export const LogbookMapResponse = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      properties: z.object({ id: z.uuid(), startedAt: z.iso.datetime().nullable() }),
      geometry: z.object({ type: z.literal('LineString'), coordinates: z.array(Position).min(2) }),
    }),
  ),
});
export type LogbookMapResponse = z.infer<typeof LogbookMapResponse>;

export const CLAIM = {
  /** Сколько анонимных загрузок браузер помнит и забирает за раз. */
  maxFlights: 50,
} as const;

/** POST /api/v1/flights/claim — забрать в логбук полёты, загруженные до входа. */
export const ClaimRequest = z.object({
  claims: z
    .array(z.object({ flightId: z.uuid(), token: z.string().min(1) }))
    .min(1)
    .max(CLAIM.maxFlights),
});
export type ClaimRequest = z.infer<typeof ClaimRequest>;

export const ClaimResponse = z.object({
  /** Полёты, которые теперь в логбуке. Остальные — чужие, уже с владельцем или удалены. */
  claimed: z.array(z.uuid()),
});
export type ClaimResponse = z.infer<typeof ClaimResponse>;
