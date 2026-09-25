import { parentPort } from 'node:worker_threads';

import { cleanAndDerive } from '@skyline/analysis';
import type { FlightErrorCode, GnssAltitudeDatum, ParsedTrack, ParseResult, SourceFormat } from '@skyline/core';
import { parseGpx, parseIgc, parseKml } from '@skyline/parsing';
import { writeTrack } from '@skyline/track-format';

/**
 * Точка входа потока конвейера: parse → clean → derive → pack (ТЗ §5.2, шаги 2–4, 9).
 * Всё CPU-тяжёлое исполняется здесь, а не в основном потоке воркера.
 * Сеть и база — снаружи: сюда приходят байты, отсюда уходит готовый .track.
 */

export interface PipelineTaskMessage {
  sourceFormat: SourceFormat;
  bytes: Uint8Array;
  /** «Сейчас» для санити-чека даты в парсере. */
  now: number;
}

export interface PipelineSuccess {
  ok: true;
  track: ArrayBuffer;
  pointCount: number;
  analysisLevel: 'full' | 'basic';
  altitudeSource: 'baro' | 'gnss';
  /** Датум GNSS-высоты в исходном файле — для логов: assumed-geoid видно по прибору (спек высот). */
  gnssAltitudeDatum: GnssAltitudeDatum;
  /** UNIX мс первой и последней точки. */
  startedAt: number;
  endedAt: number;
  durationS: number;
  warningCount: number;
}

export type PipelineMessage =
  /** Поток загрузился и готов принимать задачи: с этого момента идёт отсчёт таймаута. */
  | { type: 'ready' }
  | { type: 'progress'; value: number }
  | { type: 'result'; result: PipelineSuccess | { ok: false; errorCode: FlightErrorCode } };

/** Доли выполненного по шагам — их видит пользователь в SSE. */
const PROGRESS = { parsed: 0.4, derived: 0.75, packed: 0.95, done: 1 } as const;
const MS_PER_SECOND = 1000;

function parse(message: PipelineTaskMessage): ParseResult | null {
  const options = { now: message.now };
  switch (message.sourceFormat) {
    case 'igc':
      return parseIgc(message.bytes, options);
    case 'gpx':
      return parseGpx(message.bytes, options);
    case 'kml':
      return parseKml(message.bytes, options);
    default:
      // fit и csv — Фаза 2+ (ТЗ §3.2).
      return null;
  }
}

export function runPipeline(message: PipelineTaskMessage, onProgress: (value: number) => void): PipelineMessage {
  const parsed: ParseResult | null = parse(message);
  if (!parsed) return { type: 'result', result: { ok: false, errorCode: 'unsupported_format' } };
  if (!parsed.ok) return { type: 'result', result: { ok: false, errorCode: parsed.code } };
  onProgress(PROGRESS.parsed);

  const track: ParsedTrack = parsed.track;
  const derived = cleanAndDerive(track);
  onProgress(PROGRESS.derived);

  const { points } = derived;
  if (points.t.length === 0) return { type: 'result', result: { ok: false, errorCode: 'no_fixes' } };

  const buffer = writeTrack({
    t: points.t,
    lat: points.lat,
    lon: points.lon,
    alt: points.altitude,
    vSpeed: points.vSpeedInstant,
    gSpeed: points.groundSpeed,
    heading: points.heading,
    flags: points.flags,
  });
  onProgress(PROGRESS.packed);

  const startedAt = points.t[0] ?? Number.NaN;
  const endedAt = points.t[points.t.length - 1] ?? Number.NaN;
  onProgress(PROGRESS.done);

  return {
    type: 'result',
    result: {
      ok: true,
      track: buffer,
      pointCount: points.t.length,
      analysisLevel: derived.analysisLevel,
      altitudeSource: derived.altitudeSource,
      // Парсер заполняет датум всегда; 'none' — на случай парсера, который его не выставил.
      gnssAltitudeDatum: track.meta.gnssAltitudeDatum ?? 'none',
      startedAt,
      endedAt,
      durationS: Math.round((endedAt - startedAt) / MS_PER_SECOND),
      warningCount: track.warnings.length,
    },
  };
}

if (parentPort) {
  const port = parentPort;
  // Загрузка потока (импорт пакетов) занимает сотни миллисекунд — она не должна
  // съедать бюджет обработки, поэтому основной поток ждёт этого сообщения.
  port.postMessage({ type: 'ready' } satisfies PipelineMessage);
  port.on('message', (message: PipelineTaskMessage) => {
    try {
      const outcome = runPipeline(message, (value) => port.postMessage({ type: 'progress', value }));
      port.postMessage(outcome, outcome.type === 'result' && outcome.result.ok ? [outcome.result.track] : []);
    } catch (cause) {
      // Наружу уходит только код, но причина обязана попасть в логи: пустой
      // catch делал «поток не загрузился» неотличимым от отказа парсера.
      console.error('pipeline task failed', cause);
      port.postMessage({ type: 'result', result: { ok: false, errorCode: 'internal_error' } });
    }
  });
}
