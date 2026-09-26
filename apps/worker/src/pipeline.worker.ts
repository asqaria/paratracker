import { parentPort } from 'node:worker_threads';

import { analyseFlight, cleanAndDerive, flightRange, simplifyTrack, summarizeFlight } from '@skyline/analysis';
import {
  DEFAULT_AIRCRAFT_TYPE,
  TRACK_FLAGS,
  type FlightAnalysis,
  type FlightErrorCode,
  type GnssAltitudeDatum,
  type ParsedTrack,
  type ParseResult,
  type SimplifiedLine,
  type SourceFormat,
  type FlightPoint,
} from '@skyline/core';
import { parseGpx, parseIgc, parseKml } from '@skyline/parsing';
import { writeTrack } from '@skyline/track-format';

/**
 * Точка входа потока конвейера: parse → clean → derive → analyse → pack
 * (ТЗ §5.2, шаги 2–6, 9).
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
  /** Термики, глайды, ветер; null — трек 'basic', анализ не делался. */
  analysis: FlightAnalysis | null;
  /** Максимальная высота очищенного трека, м; NaN — высоты нет. */
  maxAltM: number;
  /** Длина очищенного трека, м. */
  distanceTrackM: number;
  /** Линия для карты логбука; null — меньше двух точек, линии нет. */
  simplified: SimplifiedLine | null;
  /** Взлёт и посадка по скорости (flightRange): по ним ищется место старта (§6.8). */
  takeoff: FlightPoint;
  landing: FlightPoint;
}

export type PipelineMessage =
  /** Поток загрузился и готов принимать задачи: с этого момента идёт отсчёт таймаута. */
  | { type: 'ready' }
  | { type: 'progress'; value: number }
  | { type: 'result'; result: PipelineSuccess | { ok: false; errorCode: FlightErrorCode } };

/** Доли выполненного по шагам — их видит пользователь в SSE. */
const PROGRESS = { parsed: 0.4, derived: 0.6, analysed: 0.85, packed: 0.95, done: 1 } as const;
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

  const analysis = analyseFlight(derived, DEFAULT_AIRCRAFT_TYPE);
  // Точки термиков — флагом в .track: просмотрщик рисует термики без отдельного запроса.
  for (const thermal of analysis?.thermals ?? []) {
    for (let i = thermal.startIndex; i <= thermal.endIndex; i++) {
      points.flags[i] = (points.flags[i] ?? 0) | TRACK_FLAGS.thermal;
    }
  }
  onProgress(PROGRESS.analysed);

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

  // Сводка и линия для логбука — по тем же очищенным точкам, что и .track.
  const summary = summarizeFlight({ t: points.t, lat: points.lat, lon: points.lon, alt: points.altitude });
  const { indices } = simplifyTrack(points.lat, points.lon);
  const pick = (column: Float64Array): number[] => Array.from(indices, (i) => column[i] ?? Number.NaN);
  const simplified: SimplifiedLine | null =
    indices.length >= 2
      ? { lat: pick(points.lat), lon: pick(points.lon), altM: pick(points.altitude), timeMs: pick(points.t) }
      : null;

  // Место старта ищется по взлёту, а не по первой точке: трек включают и до подъёма пешком.
  const range = flightRange(points.t, points.groundSpeed);
  const pointAt = (i: number): FlightPoint => ({
    lat: points.lat[i] ?? Number.NaN,
    lon: points.lon[i] ?? Number.NaN,
    altM: points.altitude[i] ?? Number.NaN,
  });

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
      analysis,
      maxAltM: summary.maxAltM,
      distanceTrackM: summary.distanceTrackM,
      simplified,
      takeoff: pointAt(range.takeoff),
      landing: pointAt(range.landing),
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
