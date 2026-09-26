import { describe, expect, it } from 'vitest';

import {
  alignmentOffsets,
  compareTimeline,
  defaultAlignment,
  SAME_DAY_SPREAD_MS,
  type CompareTrackTimes,
} from './compare-timeline';
import { compareColor, COMPARE_COLORS } from './compare-palette';

const H = 3_600_000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 6, 15, 8);

// Первый взлетает в 9:00, второй — в 9:30 того же дня.
const a: CompareTrackTimes = { startMs: T0, endMs: T0 + 3 * H, takeoffMs: T0 + H };
const b: CompareTrackTimes = { startMs: T0 + H, endMs: T0 + 4 * H, takeoffMs: T0 + 1.5 * H };

describe('alignmentOffsets', () => {
  it('абсолютное время — без сдвигов', () => {
    expect(alignmentOffsets([a, b], 'absolute')).toEqual([0, 0]);
  });

  it('по взлёту — все взлетают вместе с первым', () => {
    const offsets = alignmentOffsets([a, b], 'takeoff');
    expect(offsets).toEqual([0, -0.5 * H]);
    expect(b.takeoffMs + (offsets[1] ?? 0)).toBe(a.takeoffMs);
  });

  it('полёта в записи нет — взлёт считается от начала трека', () => {
    const walk = { startMs: T0 + 2 * H, endMs: T0 + 3 * H, takeoffMs: Number.NaN };
    expect(alignmentOffsets([a, walk], 'takeoff')).toEqual([0, -H]);
  });
});

describe('compareTimeline', () => {
  it('охватывает все треки со сдвигами', () => {
    expect(compareTimeline([a, b], [0, 0])).toEqual({ startMs: T0, endMs: T0 + 4 * H });
    expect(compareTimeline([a, b], [0, -0.5 * H])).toEqual({ startMs: T0, endMs: T0 + 3.5 * H });
    expect(compareTimeline([], [])).toEqual({ startMs: 0, endMs: 0 });
  });
});

describe('defaultAlignment', () => {
  it('один день — абсолютное; разные дни — по взлёту', () => {
    expect(defaultAlignment([a, b])).toBe('absolute');
    const nextDay = { ...b, startMs: b.startMs + DAY, endMs: b.endMs + DAY, takeoffMs: b.takeoffMs + DAY };
    expect(defaultAlignment([a, nextDay])).toBe('takeoff');
    expect(SAME_DAY_SPREAD_MS).toBeLessThan(DAY);
    expect(defaultAlignment([a])).toBe('absolute');
  });
});

describe('compareColor', () => {
  it('восемь различных цветов, дальше — по кругу', () => {
    expect(new Set(COMPARE_COLORS).size).toBe(8);
    expect(compareColor(0)).toBe(COMPARE_COLORS[0]);
    expect(compareColor(8)).toBe(COMPARE_COLORS[0]);
  });
});
