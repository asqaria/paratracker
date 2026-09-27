import { CommentDto, CommentsResponse, type NewComment } from '@skyline/core';

import { fetchWithSession } from '../auth/session';
import { withShare } from '../sharing/sharing-api';

/** Комментарии к полёту (задача 3.10б). share — токен ссылки полёта «По ссылке». */

const ACCEPT = { accept: 'application/json, application/problem+json' } as const;

export const commentsKey = (flightId: string) => ['comments', flightId] as const;

const url = (flightId: string, share: string | null, tail = ''): string =>
  withShare(`/api/v1/flights/${flightId}/comments${tail}`, share);

export async function fetchComments(flightId: string, share: string | null, fetchImpl: typeof fetch = fetch): Promise<CommentDto[]> {
  const response = await fetchWithSession(url(flightId, share), { headers: ACCEPT }, fetchImpl);
  if (!response.ok) throw new Error(`Comments: HTTP ${response.status}`);
  return CommentsResponse.parse(await response.json()).comments;
}

export async function postComment(
  flightId: string,
  share: string | null,
  comment: NewComment,
  fetchImpl: typeof fetch = fetch,
): Promise<CommentDto> {
  const response = await fetchWithSession(
    url(flightId, share),
    { method: 'POST', headers: { ...ACCEPT, 'content-type': 'application/json' }, body: JSON.stringify(comment) },
    fetchImpl,
  );
  if (!response.ok) throw new Error(`Post comment: HTTP ${response.status}`);
  return CommentDto.parse(await response.json());
}

export async function deleteComment(
  flightId: string,
  share: string | null,
  commentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchWithSession(url(flightId, share, `/${commentId}`), { method: 'DELETE', headers: ACCEPT }, fetchImpl);
  if (!response.ok) throw new Error(`Delete comment: HTTP ${response.status}`);
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MS_PER_SECOND = 1000;

/** «1:23:40» — момент полёта от начала записи. */
export function timecodeLabel(seconds: number): string {
  const h = Math.floor(seconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR));
  const m = Math.floor(seconds / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const s = seconds % SECONDS_PER_MINUTE;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Момент проигрывания → секунды от начала записи (started_at); до начала — 0. */
export const timecodeAt = (timeMs: number, startedAtMs: number): number =>
  Math.max(0, Math.round((timeMs - startedAtMs) / MS_PER_SECOND));

/** Секунды от начала записи → время сцены для перемотки. */
export const timeOfTimecode = (seconds: number, startedAtMs: number): number => startedAtMs + seconds * MS_PER_SECOND;
