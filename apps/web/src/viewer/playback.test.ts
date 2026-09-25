import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAYBACK_SPEED,
  durationSeconds,
  elapsedClock,
  fractionAt,
  indexAt,
  nextSpeed,
  PLAYBACK_SPEEDS,
  seekBy,
  timeAtFraction,
  timelineOf,
} from './playback';

const START = Date.UTC(2026, 6, 15, 9);
const grid = (count: number): Float64Array => Float64Array.from({ length: count }, (_, i) => START + i * 1000);

describe('таймлайн трека', () => {
  it('границы и длительность из сетки 1 Гц', () => {
    const timeline = timelineOf(grid(960));
    expect(timeline).toEqual({ startMs: START, endMs: START + 959_000, pointCount: 960 });
    expect(durationSeconds(timeline)).toBe(959);
  });

  it('индекс по времени, за границами — крайняя точка', () => {
    const t = grid(100);
    expect(indexAt(t, START)).toBe(0);
    expect(indexAt(t, START + 42_400)).toBe(42);
    expect(indexAt(t, START - 5_000)).toBe(0);
    expect(indexAt(t, START + 10_000_000)).toBe(99);
  });

  it('пустой трек не ломает индекс', () => {
    expect(indexAt(new Float64Array(), START)).toBe(0);
  });

  it('доля и обратный перевод согласованы', () => {
    const timeline = timelineOf(grid(101));
    expect(fractionAt(timeline, START)).toBe(0);
    expect(fractionAt(timeline, START + 50_000)).toBeCloseTo(0.5, 9);
    expect(fractionAt(timeline, START + 500_000)).toBe(1);
    expect(timeAtFraction(timeline, 0.5)).toBe(START + 50_000);
    expect(timeAtFraction(timeline, -1)).toBe(START);
    expect(timeAtFraction(timeline, 2)).toBe(timeline.endMs);
  });

  it('трек из одной точки — доля 0, без делений на ноль', () => {
    const timeline = timelineOf(grid(1));
    expect(fractionAt(timeline, START)).toBe(0);
    expect(durationSeconds(timeline)).toBe(0);
  });

  it('перемотка зажимается в границы трека', () => {
    const timeline = timelineOf(grid(61));
    expect(seekBy(timeline, START + 10_000, 1)).toBe(START + 11_000);
    expect(seekBy(timeline, START + 10_000, -60)).toBe(START);
    expect(seekBy(timeline, START + 10_000, 600)).toBe(timeline.endMs);
  });

  it('скорости проигрывания по ТЗ §7.5', () => {
    expect(PLAYBACK_SPEEDS).toEqual([1, 2, 4, 8, 16, 60]);
    expect(PLAYBACK_SPEEDS).toContain(DEFAULT_PLAYBACK_SPEED);
  });

  it('счётчик времени от начала полёта', () => {
    const timeline = timelineOf(grid(4000));
    expect(elapsedClock(timeline, START)).toBe('00:00:00');
    expect(elapsedClock(timeline, START + 3_661_000)).toBe('01:01:01');
    expect(elapsedClock(timeline, START - 5_000)).toBe('00:00:00');
  });
});

describe('nextSpeed — одна кнопка скорости на телефоне', () => {
  it('идёт по скоростям ТЗ по кругу', () => {
    const visited = [DEFAULT_PLAYBACK_SPEED];
    for (let i = 0; i < PLAYBACK_SPEEDS.length; i++) visited.push(nextSpeed(visited.at(-1) ?? DEFAULT_PLAYBACK_SPEED));
    expect(visited).toEqual([4, 8, 16, 60, 1, 2, 4]);
  });
});
