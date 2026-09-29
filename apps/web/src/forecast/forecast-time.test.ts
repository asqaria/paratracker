import type { ForecastVerdict } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { dayWindows, defaultHour, forecastDays, localHour } from './forecast-time';

const TZ = 'Asia/Almaty';
/** Алматы — UTC+5: 03:00 UTC — 08:00 местного. */
const utc = (day: number, hour: number): string => new Date(Date.UTC(2026, 8, day, hour)).toISOString();
const threeDays = Array.from({ length: 72 }, (_, i) => new Date(Date.UTC(2026, 8, 29, i)).toISOString());

describe('localHour', () => {
  it('UTC → местные дата и час места', () => {
    expect(localHour(utc(29, 3), TZ)).toMatchObject({ dayKey: '2026-09-29', hour: 8 });
    expect(localHour(utc(29, 20), TZ)).toMatchObject({ dayKey: '2026-09-30', hour: 1 });
  });
});

describe('forecastDays', () => {
  it('только светлые часы 8–20 по местным дням', () => {
    const days = forecastDays(threeDays, TZ, Date.UTC(2026, 8, 28));
    expect(days.map((d) => d.dayKey)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    expect(days[0]?.hours.map((h) => h.hour)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('прошедшие часы отброшены, текущий остаётся; по умолчанию — ближайший', () => {
    // 29.09 12:30 местного.
    const days = forecastDays(threeDays, TZ, Date.UTC(2026, 8, 29, 7, 30));
    expect(days[0]?.hours[0]?.hour).toBe(12);
    expect(defaultHour(days)?.time).toBe(utc(29, 7));
  });

  it('вечером сегодняшний день уже кончился — первым идёт завтра', () => {
    const days = forecastDays(threeDays, TZ, Date.UTC(2026, 8, 29, 17));
    expect(days[0]?.dayKey).toBe('2026-09-30');
  });

  it('пустой прогноз — нет дней и часа по умолчанию', () => {
    expect(defaultHour(forecastDays([], TZ, 0))).toBeNull();
  });
});

describe('dayWindows', () => {
  it('окно «лететь» — с первого до последнего лётного часа, XC — отдельно', () => {
    const [day] = forecastDays(threeDays, TZ, Date.UTC(2026, 8, 28));
    const verdicts: Record<number, ForecastVerdict> = { 10: 'flyable', 11: 'xc', 12: 'xc', 13: 'marginal', 15: 'flyable', 18: 'nofly' };
    const windows = dayWindows(day?.hours ?? [], (time) => verdicts[localHour(time, TZ).hour] ?? 'nofly');
    expect(windows).toEqual({ fly: [10, 15], xc: [11, 12] });
  });

  it('нелётный день — окон нет', () => {
    const [day] = forecastDays(threeDays, TZ, Date.UTC(2026, 8, 28));
    expect(dayWindows(day?.hours ?? [], () => 'nofly')).toEqual({ fly: null, xc: null });
  });
});
