import { useEffect, useState } from 'react';

import type { DecodedTrack } from './decode-track';
import type { DecodeRequest, DecodeResponse } from './decode-track.worker';

/** Загрузка .track и декодирование в воркере: основной поток не занят разбором. */

export type TrackState =
  | { status: 'loading' }
  | { status: 'ready'; track: DecodedTrack }
  | { status: 'error'; message: string };

/**
 * Скачать и декодировать один трек. Свой воркер на трек: сравнение (задача 3.12)
 * грузит до 8 треков параллельно, и декодирование не встаёт в очередь.
 */
export async function loadTrack(url: string, signal: AbortSignal): Promise<DecodedTrack> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  signal.throwIfAborted();

  const worker = new Worker(new URL('./decode-track.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<DecodedTrack>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
        if (event.data.ok) resolve(event.data.track);
        else reject(new Error(event.data.message));
      };
      worker.onerror = (event) => reject(new Error(event.message));
      const request: DecodeRequest = { buffer };
      worker.postMessage(request, [buffer]);
    });
  } finally {
    worker.terminate();
  }
}

export function useTrack(url: string): TrackState {
  const [state, setState] = useState<TrackState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    loadTrack(url, controller.signal).then(
      (track) => setState({ status: 'ready', track }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => controller.abort();
  }, [url]);

  return state;
}
