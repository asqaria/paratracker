import type { ForecastVerdict } from '@skyline/core';

/**
 * Время прогноза на карте (задача П.3, ТЗ §6.9): в API — UTC, пилоту —
 * местное время места старта (по его timezone). Показываем только светлые
 * часы: ночью «лётно, только слёт» — не прогноз, а шум.
 */

export const DAYLIGHT = {
  /** С 8:00 до 20:00 местного — когда реально летают. */
  fromHour: 8,
  toHour: 20,
} as const;

const MS_PER_HOUR = 3_600_000;

export interface LocalHour {
  /** ISO UTC — ключ часа в ответе API. */
  time: string;
  ms: number;
  /** Местная дата YYYY-MM-DD. */
  dayKey: string;
  /** Местный час 0–23. */
  hour: number;
}

export interface ForecastDay {
  dayKey: string;
  hours: LocalHour[];
}

export function localHour(time: string, timezone: string): LocalHour {
  const ms = Date.parse(time);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return { time, ms, dayKey: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

/**
 * Светлые часы по местным дням. Прошедшие часы отбрасываются (текущий час
 * остаётся); день без оставшихся светлых часов не показывается.
 */
export function forecastDays(times: readonly string[], timezone: string, nowMs: number): ForecastDay[] {
  const days: ForecastDay[] = [];
  for (const time of times) {
    const local = localHour(time, timezone);
    if (local.hour < DAYLIGHT.fromHour || local.hour > DAYLIGHT.toHour) continue;
    if (local.ms + MS_PER_HOUR <= nowMs) continue;
    const day = days.at(-1);
    if (day?.dayKey === local.dayKey) day.hours.push(local);
    else days.push({ dayKey: local.dayKey, hours: [local] });
  }
  return days;
}

/** Час по умолчанию: ближайший светлый — первый час первого дня. */
export const defaultHour = (days: readonly ForecastDay[]): LocalHour | null => days[0]?.hours[0] ?? null;

const FLY: ReadonlySet<ForecastVerdict> = new Set(['xc', 'flyable']);

export interface DayWindows {
  /** Первый и последний местный час «лететь» (XC или лётно); null — нелётный день. */
  fly: [number, number] | null;
  /** То же для XC-часов. */
  xc: [number, number] | null;
}

/** Окна дня для вердикта в шапке панели: «Лётно с 11 до 17, XC 13–15». */
export function dayWindows(hours: readonly LocalHour[], verdictOf: (time: string) => ForecastVerdict | undefined): DayWindows {
  const span = (keep: (verdict: ForecastVerdict) => boolean): [number, number] | null => {
    const picked = hours.filter((h) => {
      const verdict = verdictOf(h.time);
      return verdict !== undefined && keep(verdict);
    });
    const first = picked[0];
    const last = picked.at(-1);
    return first && last ? [first.hour, last.hour] : null;
  };
  return { fly: span((v) => FLY.has(v)), xc: span((v) => v === 'xc') };
}
