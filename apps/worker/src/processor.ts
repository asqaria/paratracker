import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

import { UNFINISHED_FLIGHT_STATUSES, type FlightErrorCode, type FlightStatusResponse } from '@skyline/core';
import type { FlightRecord, ProcessedFlight } from '@skyline/db';

import { trackObjectKey as defaultTrackObjectKey } from './constants.js';
import type { PipelinePool } from './pool.js';

/** Обработка одного полёта: сеть и база здесь, счёт — в пуле потоков. */

export interface ObjectStorage {
  get(key: string): Promise<Uint8Array>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export interface FlightRepository {
  find(id: string): Promise<FlightRecord | null>;
  markProcessing(id: string): Promise<void>;
  markReady(id: string, result: ProcessedFlight): Promise<void>;
  markFailed(id: string, errorCode: string): Promise<void>;
}

export type StatusNotifier = (event: FlightStatusResponse) => Promise<void>;

export interface FlightProcessorDeps {
  pool: PipelinePool;
  storage: ObjectStorage;
  repository: FlightRepository;
  notify: StatusNotifier;
  now?: () => number;
  trackObjectKey?: (flightId: string) => string;
  onError?: (error: unknown, flightId: string) => void;
}

export interface FlightProcessor {
  process(flightId: string): Promise<void>;
}

const gunzipAsync = promisify(gunzip);
const MS_PER_SECOND = 1000;

export function createFlightProcessor(deps: FlightProcessorDeps): FlightProcessor {
  const now = deps.now ?? Date.now;
  const keyFor = deps.trackObjectKey ?? defaultTrackObjectKey;

  const announce = async (
    flightId: string,
    status: FlightStatusResponse['status'],
    extra: { progress?: number; errorCode?: FlightErrorCode; trackReady?: boolean } = {},
  ): Promise<void> => {
    await deps.notify({
      flightId,
      status,
      trackReady: extra.trackReady ?? false,
      ...(extra.progress === undefined ? {} : { progress: extra.progress }),
      ...(extra.errorCode === undefined ? {} : { errorCode: extra.errorCode }),
    });
  };

  const fail = async (flightId: string, errorCode: FlightErrorCode): Promise<void> => {
    await deps.repository.markFailed(flightId, errorCode);
    await announce(flightId, 'failed', { errorCode });
  };

  return {
    process: async (flightId) => {
      const flight = await deps.repository.find(flightId);
      if (!flight) return;
      // Готовые и упавшие полёты повторно не обрабатываем: перезапуск воркера
      // не должен переделывать уже сделанное.
      if (!UNFINISHED_FLIGHT_STATUSES.includes(flight.status as (typeof UNFINISHED_FLIGHT_STATUSES)[number])) return;

      await deps.repository.markProcessing(flightId);
      await announce(flightId, 'parsing', { progress: 0 });

      try {
        const raw = await deps.storage.get(flight.rawObjectKey);
        const bytes = await gunzipAsync(raw);

        const result = await deps.pool.run({ sourceFormat: flight.sourceFormat, bytes, now: now() }, (progress) => {
          void announce(flightId, 'parsing', { progress });
        });
        if (!result.ok) {
          await fail(flightId, result.errorCode);
          return;
        }

        const key = keyFor(flightId);
        await deps.storage.put(key, new Uint8Array(result.track), 'application/octet-stream');
        await deps.repository.markReady(flightId, {
          trackObjectKey: key,
          altitudeSource: result.altitudeSource,
          analysisLevel: result.analysisLevel,
          startedAt: new Date(result.startedAt),
          endedAt: new Date(result.endedAt),
          durationS: Math.round((result.endedAt - result.startedAt) / MS_PER_SECOND),
        });
        await announce(flightId, 'ready', { progress: 1, trackReady: true });
      } catch (error) {
        deps.onError?.(error, flightId);
        await fail(flightId, 'internal_error');
      }
    },
  };
}
