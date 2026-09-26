import { parentPort } from 'node:worker_threads';

import {
  analyseFlight,
  cleanAndDerive,
  flightRange,
  simplifyTrack,
  summarizeFlight,
  totalGain,
  visibleRange,
} from '@skyline/analysis';
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
  type XcScore,
} from '@skyline/core';
import { parseGpx, parseIgc, parseKml } from '@skyline/parsing';
import { writeTrack } from '@skyline/track-format';

// .ts, а не .js: поток в тестах грузит исходник напрямую (tsconfig: rewriteRelativeImportExtensions).
import { scoreXc } from './xc-score.ts';

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
  /**
   * .track для посторонних (задача 3.7): от взлёта до посадки плюс секунды
   * по краям, без записи на земле; null — полёта нет, посторонним нечего показать.
   */
  publicTrack: ArrayBuffer | null;
  /** Упрощённая линия того же участка — для картинки-превью (задача 3.8). */
  publicLine: { lat: number[]; lon: number[] } | null;
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
  /** Модель крыла из заголовка файла (IGC HFGTY); null — прибор не записал. */
  gliderRaw: string | null;
  /** Время в воздухе от взлёта до посадки, с (задача 2.12): без подъёма пешком и сборов. */
  airtimeS: number;
  /** Сумма подъёмов в воздухе с гистерезисом GAIN.hysteresisM, м (задача 2.12). */
  totalGainM: number;
  /** XC-очки по регламенту по умолчанию (задача 3.1); null — считать не по чему. */
  xc: XcScore | null;
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

/** Дуглас–Пекер по участку [takeoff, landing] — сотни точек вместо десятков тысяч. */
function simplifiedLine(lat: Float64Array, lon: Float64Array, range: { takeoff: number; landing: number }) {
  const la = lat.subarray(range.takeoff, range.landing + 1);
  const lo = lon.subarray(range.takeoff, range.landing + 1);
  const { indices } = simplifyTrack(la, lo);
  return { lat: Array.from(indices, (i) => la[i] ?? 0), lon: Array.from(indices, (i) => lo[i] ?? 0) };
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

  const columns = {
    t: points.t,
    lat: points.lat,
    lon: points.lon,
    alt: points.altitude,
    vSpeed: points.vSpeedInstant,
    gSpeed: points.groundSpeed,
    heading: points.heading,
    flags: points.flags,
  };
  const buffer = writeTrack(columns);
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

  const visible = visibleRange(points.t, range);
  const publicTrack = visible
    ? writeTrack({
        t: columns.t.subarray(visible.takeoff, visible.landing + 1),
        lat: columns.lat.subarray(visible.takeoff, visible.landing + 1),
        lon: columns.lon.subarray(visible.takeoff, visible.landing + 1),
        alt: columns.alt.subarray(visible.takeoff, visible.landing + 1),
        vSpeed: columns.vSpeed.subarray(visible.takeoff, visible.landing + 1),
        gSpeed: columns.gSpeed.subarray(visible.takeoff, visible.landing + 1),
        heading: columns.heading.subarray(visible.takeoff, visible.landing + 1),
        flags: columns.flags.subarray(visible.takeoff, visible.landing + 1),
      })
    : null;
  const publicLine = visible ? simplifiedLine(points.lat, points.lon, visible) : null;

  const startedAt = points.t[0] ?? Number.NaN;
  const endedAt = points.t[points.t.length - 1] ?? Number.NaN;
  onProgress(PROGRESS.done);

  return {
    type: 'result',
    result: {
      ok: true,
      track: buffer,
      publicTrack,
      publicLine,
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
      gliderRaw: track.meta.glider?.trim() || null,
      airtimeS: Math.round(((points.t[range.landing] ?? 0) - (points.t[range.takeoff] ?? 0)) / MS_PER_SECOND),
      totalGainM: totalGain(points.altitude, range.takeoff, range.landing),
      // Скоринг — только у полноценного трека: у редкого (basic) нет точной геометрии.
      xc:
        derived.analysisLevel === 'full'
          ? scoreXc({ t: points.t, lat: points.lat, lon: points.lon, altitude: points.altitude }, range)
          : null,
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
      const transfer =
        outcome.type === 'result' && outcome.result.ok
          ? [outcome.result.track, ...(outcome.result.publicTrack ? [outcome.result.publicTrack] : [])]
          : [];
      port.postMessage(outcome, transfer);
    } catch (cause) {
      // Наружу уходит только код, но причина обязана попасть в логи: пустой
      // catch делал «поток не загрузился» неотличимым от отказа парсера.
      console.error('pipeline task failed', cause);
      port.postMessage({ type: 'result', result: { ok: false, errorCode: 'internal_error' } });
    }
  });
}
