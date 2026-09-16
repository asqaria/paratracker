import { useEffect, useState } from 'react';

import type { DecodedTrack } from './decode-track';
import type { DecodeRequest, DecodeResponse } from './decode-track.worker';

/** Загрузка .track и декодирование в воркере: основной поток не занят разбором. */

export type TrackState =
  | { status: 'loading' }
  | { status: 'ready'; track: DecodedTrack }
  | { status: 'error'; message: string };

export function useTrack(url: string): TrackState {
  const [state, setState] = useState<TrackState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const worker = new Worker(new URL('./decode-track.worker.ts', import.meta.url), { type: 'module' });
    let cancelled = false;

    worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
      if (cancelled) return;
      setState(
        event.data.ok ? { status: 'ready', track: event.data.track } : { status: 'error', message: event.data.message },
      );
    };
    worker.onerror = (event) => {
      if (!cancelled) setState({ status: 'error', message: event.message });
    };

    setState({ status: 'loading' });
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (cancelled) return;
        const request: DecodeRequest = { buffer };
        worker.postMessage(request, [buffer]);
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      worker.terminate();
    };
  }, [url]);

  return state;
}
