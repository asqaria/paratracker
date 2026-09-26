import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

import tzlookup from '@photostructure/tz-lookup';
import {
  UNFINISHED_FLIGHT_STATUSES,
  type AltitudeSource,
  type FlightErrorCode,
  type FlightStatusResponse,
  type GnssAltitudeDatum,
} from '@skyline/core';
import type { FlightRecord, ProcessedFlight } from '@skyline/db';

import { trackObjectKey as defaultTrackObjectKey } from './constants.js';
import type { PipelineSuccess } from './pipeline.worker.js';
import type { PipelinePool } from './pool.js';
import { renderPreview, type TileSource } from './preview.js';

/** Обработка одного полёта: сеть и база здесь, счёт — в пуле потоков. */

export interface ObjectStorage {
  get(key: string): Promise<Uint8Array>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Идемпотентно: отсутствующий ключ — не ошибка (так ведёт себя S3). */
  delete(key: string): Promise<void>;
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
  /** Подложка превью (задача 3.8); нет ключа — превью на тёмном фоне. */
  tiles?: TileSource | null;
  /** Полёт обработан — для структурного лога с flightId (датум высоты, источник, точки). */
  onReady?: (flightId: string, summary: ReadySummary) => void;
}

export interface ReadySummary {
  pointCount: number;
  altitudeSource: AltitudeSource;
  gnssAltitudeDatum: GnssAltitudeDatum;
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

  const renderAndStorePreview = async (
    flightId: string,
    trackKey: string,
    result: PipelineSuccess,
  ): Promise<string | null> => {
    if (!result.publicLine) return null;
    const jpeg = await renderPreview(
      {
        ...result.publicLine,
        xc: result.xc?.route ?? null,
        xcClosed: result.xc !== null && result.xc.type !== 'free_distance',
      },
      deps.tiles ?? null,
    );
    if (!jpeg) return null;
    const previewKey = trackKey.replace(/^tracks\//, 'previews/').replace(/\.track$/, '.jpg');
    await deps.storage.put(previewKey, jpeg, 'image/jpeg');
    return previewKey;
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
        // Для посторонних — без записи на земле (задача 3.7): рядом с полным, с суффиксом.
        const publicKey = result.publicTrack ? key.replace(/\.track$/, '.public.track') : null;
        if (publicKey && result.publicTrack) {
          await deps.storage.put(publicKey, new Uint8Array(result.publicTrack), 'application/octet-stream');
        }
        // Превью для мессенджеров (задача 3.8): не вышло — полёт всё равно готов, превью догрузится.
        const previewKey = await renderAndStorePreview(flightId, key, result).catch((error: unknown) => {
          deps.onError?.(error, flightId);
          return null;
        });
        await deps.repository.markReady(flightId, {
          trackObjectKey: key,
          publicTrackObjectKey: publicKey,
          previewObjectKey: previewKey,
          altitudeSource: result.altitudeSource,
          analysisLevel: result.analysisLevel,
          startedAt: new Date(result.startedAt),
          endedAt: new Date(result.endedAt),
          durationS: Math.round((result.endedAt - result.startedAt) / MS_PER_SECOND),
          analysis: result.analysis,
          maxAltM: result.maxAltM,
          distanceTrackM: result.distanceTrackM,
          simplified: result.simplified,
          takeoff: result.takeoff,
          landing: result.landing,
          gliderRaw: result.gliderRaw,
          airtimeS: result.airtimeS,
          totalGainM: result.totalGainM,
          xc: result.xc,
          // Таймзона — по точке взлёта (IANA): из неё местная дата и время полёта (задача 2.14).
          timezone: Number.isFinite(result.takeoff.lat) && Number.isFinite(result.takeoff.lon)
            ? tzlookup(result.takeoff.lat, result.takeoff.lon)
            : null,
        });
        await announce(flightId, 'ready', { progress: 1, trackReady: true });
        deps.onReady?.(flightId, {
          pointCount: result.pointCount,
          altitudeSource: result.altitudeSource,
          gnssAltitudeDatum: result.gnssAltitudeDatum,
        });
      } catch (error) {
        deps.onError?.(error, flightId);
        await fail(flightId, 'internal_error');
      }
    },
  };
}
