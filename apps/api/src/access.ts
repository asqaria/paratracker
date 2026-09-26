import type { Privacy } from '@skyline/core';

/**
 * Кто и что видит у полёта (задача 3.7, ТЗ §11.2).
 *
 * owner — владелец и анонимная загрузка (её открывает загрузивший браузер
 * по id сразу после загрузки): весь трек. viewer — посторонний с правом
 * смотреть: публичный полёт или «по ссылке» с верным токеном; трек — без
 * записи на земле. null — не видит ничего: ответ 404, а не 403, чтобы не
 * выдавать, что полёт есть.
 */
export type FlightView = 'owner' | 'viewer';

export interface FlightAccessFacts {
  userId: string | null;
  privacy: Privacy;
  shareToken: string | null;
}

export function viewOf(flight: FlightAccessFacts, viewerId: string | null, share: string | undefined): FlightView | null {
  if (flight.userId === null) return 'owner';
  if (viewerId !== null && viewerId === flight.userId) return 'owner';
  if (flight.privacy === 'public') return 'viewer';
  if (flight.privacy === 'unlisted' && share !== undefined && flight.shareToken !== null && share === flight.shareToken) {
    return 'viewer';
  }
  return null;
}

/** ?share= из строки запроса: токен ссылки «по ссылке». */
export function shareOf(query: unknown): string | undefined {
  if (typeof query !== 'object' || query === null || !('share' in query)) return undefined;
  const value = query.share;
  return typeof value === 'string' && value !== '' ? value : undefined;
}
