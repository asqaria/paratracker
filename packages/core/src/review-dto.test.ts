import { describe, expect, it } from 'vitest';

import { clockFromStart, ThermalReviewLabels, toLabelsFile } from './review-dto.js';

const T0 = Date.UTC(2026, 6, 15, 9);
const at = (h: number, m: number, s: number) => T0 + ((h * 60 + m) * 60 + s) * 1000;

describe('clockFromStart', () => {
  it('часы без ведущего нуля, минуты и секунды — с ним', () => {
    expect(clockFromStart(at(1, 5, 9), T0)).toBe('1:05:09');
    expect(clockFromStart(at(0, 8, 10), T0)).toBe('0:08:10');
  });
});

describe('ThermalReviewLabels', () => {
  it('конец раньше начала не принимает', () => {
    const bad = { confirmed: [{ startMs: 10, endMs: 5 }], rejected: [], missed: [] };
    expect(ThermalReviewLabels.safeParse(bad).success).toBe(false);
  });
});

describe('toLabelsFile', () => {
  it('формат *.labels.json: rejected → notThermals, время от начала трека, заметки сохраняются', () => {
    const file = toLabelsFile(
      {
        confirmed: [{ startMs: at(0, 8, 10), endMs: at(0, 19, 17) }],
        rejected: [{ startMs: at(0, 31, 46), endMs: at(0, 32, 28) }],
        missed: [{ startMs: at(1, 44, 19), endMs: at(1, 55, 40), note: 'сильный ветер' }],
      },
      'pilot-2026-07-15.igc',
      T0,
      '2026-09-27T10:00:00.000Z',
    );
    expect(file).toMatchObject({
      file: 'pilot-2026-07-15.igc',
      confirmed: [{ start: '0:08:10', end: '0:19:17' }],
      missed: [{ start: '1:44:19', end: '1:55:40', note: 'сильный ветер' }],
      notThermals: [{ start: '0:31:46', end: '0:32:28' }],
    });
    expect(file.source).toContain('2026-09-27');
  });
});
