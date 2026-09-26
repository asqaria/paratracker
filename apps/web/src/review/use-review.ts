import { EMPTY_REVIEW, ThermalReviewResponse, type ThermalReviewLabels } from '@skyline/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { fetchWithSession } from '../auth/session';

/** Разметка сверки термиков с сервера и сохранение каждой отметки сразу. */

export const reviewUrl = (flightId: string): string => `/api/v1/flights/${flightId}/review`;

export async function fetchReview(flightId: string, fetchImpl: typeof fetch = fetch): Promise<ThermalReviewResponse> {
  const response = await fetchWithSession(reviewUrl(flightId), { method: 'GET' }, fetchImpl);
  if (!response.ok) throw new Error(`Review failed: HTTP ${response.status}`);
  return ThermalReviewResponse.parse(await response.json());
}

export async function saveReview(flightId: string, labels: ThermalReviewLabels, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchWithSession(
    reviewUrl(flightId),
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(labels) },
    fetchImpl,
  );
  if (!response.ok) throw new Error(`Save review failed: HTTP ${response.status}`);
}

export type SaveState = 'saved' | 'saving' | 'error';

const reviewKey = (flightId: string) => ['thermal-review', flightId] as const;

export function useThermalReview(flightId: string) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: reviewKey(flightId),
    queryFn: () => fetchReview(flightId),
    staleTime: Infinity,
    retry: false,
  });
  const [saveState, setSaveState] = useState<SaveState>('saved');
  // Сохранения — по очереди: отметки быстрые, а порядок PUT на сервере важен.
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * Правка — функцией от текущей разметки, а не готовым значением: две отметки
   * подряд (двойной клик) иначе считались бы от одной и той же старой разметки,
   * и первая терялась.
   */
  const update = useCallback(
    (change: (labels: ThermalReviewLabels) => ThermalReviewLabels) => {
      const previous = client.getQueryData<ThermalReviewResponse>(reviewKey(flightId));
      const labels = change(previous?.labels ?? EMPTY_REVIEW);
      client.setQueryData<ThermalReviewResponse>(reviewKey(flightId), {
        labels,
        updatedAt: previous?.updatedAt ?? null,
      });
      setSaveState('saving');
      chain.current = chain.current
        .then(() => saveReview(flightId, labels))
        .then(
          () => setSaveState('saved'),
          () => setSaveState('error'),
        );
    },
    [client, flightId],
  );

  return { review: query.data, failed: query.isError, saveState, update };
}
