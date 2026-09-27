import { describe, expect, it } from 'vitest';

import { timecodeAt, timecodeLabel, timeOfTimecode } from './comments-api';

const START = Date.UTC(2026, 6, 15, 6);

describe('момент полёта в комментарии', () => {
  it('секунды от начала записи — туда и обратно', () => {
    const at = START + 5_020_400;
    expect(timecodeAt(at, START)).toBe(5020);
    expect(timeOfTimecode(5020, START)).toBe(START + 5_020_000);
    expect(timecodeAt(START - 30_000, START)).toBe(0);
  });

  it('подпись «ч:мм:сс»', () => {
    expect(timecodeLabel(5020)).toBe('1:23:40');
    expect(timecodeLabel(59)).toBe('0:00:59');
  });
});
