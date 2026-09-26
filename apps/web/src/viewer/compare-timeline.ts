/**
 * Время сравнения треков (задача 3.12). У сцены одни часы; у каждого трека —
 * сдвиг: время сцены = время трека + сдвиг. «Абсолютное» — сдвигов нет, кто
 * где был в 14:05 (разбор одного дня). «По взлёту» — все взлетают в момент
 * взлёта первого трека: себя в разные дни, ученика и инструктора.
 */

export const COMPARE_ALIGNMENTS = ['absolute', 'takeoff'] as const;
export type CompareAlignment = (typeof COMPARE_ALIGNMENTS)[number];

const MS_PER_HOUR = 3_600_000;
/**
 * Взлёты дальше 12 ч друг от друга — разные дни: в абсолютном времени
 * таймлайн растянулся бы на сутки с пустотой посередине. Такое сравнение
 * открывается «по взлёту».
 */
export const SAME_DAY_SPREAD_MS = 12 * MS_PER_HOUR;

export interface CompareTrackTimes {
  /** Первая и последняя точка трека, UNIX мс. */
  startMs: number;
  endMs: number;
  /** Взлёт (flightRange); NaN — полёта в записи нет, берётся начало трека. */
  takeoffMs: number;
}

const takeoffOf = (track: CompareTrackTimes): number => (Number.isFinite(track.takeoffMs) ? track.takeoffMs : track.startMs);

/** Сдвиг каждого трека, мс: время сцены = время трека + сдвиг. */
export function alignmentOffsets(tracks: readonly CompareTrackTimes[], alignment: CompareAlignment): number[] {
  const first = tracks[0];
  if (alignment === 'absolute' || !first) return tracks.map(() => 0);
  const anchor = takeoffOf(first);
  return tracks.map((track) => anchor - takeoffOf(track));
}

/** Время сцены: от первой точки до последней среди всех треков со сдвигами. */
export function compareTimeline(
  tracks: readonly CompareTrackTimes[],
  offsets: readonly number[],
): { startMs: number; endMs: number } {
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  tracks.forEach((track, i) => {
    const offset = offsets[i] ?? 0;
    startMs = Math.min(startMs, track.startMs + offset);
    endMs = Math.max(endMs, track.endMs + offset);
  });
  return Number.isFinite(startMs) ? { startMs, endMs } : { startMs: 0, endMs: 0 };
}

/** Один день — абсолютное время (как в ТЗ), разные дни — по взлёту. */
export function defaultAlignment(tracks: readonly CompareTrackTimes[]): CompareAlignment {
  const takeoffs = tracks.map(takeoffOf);
  if (takeoffs.length < 2) return 'absolute';
  return Math.max(...takeoffs) - Math.min(...takeoffs) > SAME_DAY_SPREAD_MS ? 'takeoff' : 'absolute';
}
