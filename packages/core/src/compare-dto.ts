import { z } from 'zod';

/**
 * Автоподбор в сравнении треков (задача 3.12в): полёты того же дня с того же
 * места — GET /api/v1/flights/{id}/same-day. Только публичные и свои: чужой
 * полёт «по ссылке» сюда не попадает, его приносят ссылкой.
 */

export const SameDayFlight = z.object({
  flightId: z.uuid(),
  /** Имя пилота: профиль, логин, заголовок IGC; null — неизвестно. */
  pilotName: z.string().nullable(),
  /** Старт записи, ISO 8601 UTC. */
  startedAt: z.iso.datetime().nullable(),
  /** IANA-таймзона места взлёта: время в подписи — местное. */
  timezone: z.string().nullable(),
  airtimeS: z.number().int().nonnegative().nullable(),
  distanceTrackM: z.number().int().nonnegative().nullable(),
  xcScore: z.number().nullable(),
  /** Полёт спрашивающего — подпись «мой». */
  own: z.boolean(),
});
export type SameDayFlight = z.infer<typeof SameDayFlight>;

export const SameDayResponse = z.object({ flights: z.array(SameDayFlight) });
export type SameDayResponse = z.infer<typeof SameDayResponse>;
