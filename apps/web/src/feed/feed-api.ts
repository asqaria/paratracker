import { FeedResponse, FollowResponse, LikeResponse, type FeedScope } from '@skyline/core';

import { fetchWithSession } from '../auth/session';
import { withShare } from '../sharing/sharing-api';

/** Лента, лайки, подписки (задача 3.10а). */

const ACCEPT = { accept: 'application/json, application/problem+json' } as const;

export const FEED_QUERY_KEY = ['feed'] as const;

export async function fetchFeed(scope: FeedScope, cursor: string | null, fetchImpl: typeof fetch = fetch): Promise<FeedResponse> {
  const query = new URLSearchParams({ scope, ...(cursor === null ? {} : { cursor }) });
  const response = await fetchWithSession(`/api/v1/feed?${query.toString()}`, { headers: ACCEPT }, fetchImpl);
  if (!response.ok) throw new Error(`Feed: HTTP ${response.status}`);
  return FeedResponse.parse(await response.json());
}

/** Лайк или снятие; share — токен ссылки для полёта «По ссылке». */
export async function setLike(
  flightId: string,
  liked: boolean,
  share: string | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<LikeResponse> {
  const response = await fetchWithSession(
    withShare(`/api/v1/flights/${flightId}/like`, share),
    { method: liked ? 'POST' : 'DELETE', headers: ACCEPT },
    fetchImpl,
  );
  if (!response.ok) throw new Error(`Like: HTTP ${response.status}`);
  return LikeResponse.parse(await response.json());
}

export async function setFollow(username: string, following: boolean, fetchImpl: typeof fetch = fetch): Promise<FollowResponse> {
  const response = await fetchWithSession(
    `/api/v1/users/${encodeURIComponent(username)}/follow`,
    { method: following ? 'POST' : 'DELETE', headers: ACCEPT },
    fetchImpl,
  );
  if (!response.ok) throw new Error(`Follow: HTTP ${response.status}`);
  return FollowResponse.parse(await response.json());
}

/** Картинка полёта для карточки (превью задачи 3.8). */
export const previewUrl = (flightId: string): string => `/api/v1/flights/${flightId}/preview.jpg`;
