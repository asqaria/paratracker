import { EMPTY_REVIEW } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { addMissed, removeMissed, reviewProgress, toggleVerdict, verdictOf } from './review-state';

const A = { startMs: 1000, endMs: 5000 };
const B = { startMs: 9000, endMs: 12_000 };

describe('review-state', () => {
  it('отметка ставится, меняется на противоположную и снимается повтором', () => {
    const confirmed = toggleVerdict(EMPTY_REVIEW, A, 'confirmed');
    expect(verdictOf(confirmed, A)).toBe('confirmed');

    const rejected = toggleVerdict(confirmed, A, 'rejected');
    expect(verdictOf(rejected, A)).toBe('rejected');
    expect(rejected.confirmed).toEqual([]);

    expect(verdictOf(toggleVerdict(rejected, A, 'rejected'), A)).toBeNull();
  });

  it('пропущенный: границы в любом порядке, по времени; пустой не добавляется', () => {
    const labels = addMissed(addMissed(EMPTY_REVIEW, B.endMs, B.startMs), A.startMs, A.endMs);
    expect(labels.missed).toEqual([A, B]);
    expect(addMissed(EMPTY_REVIEW, 5000, 5000)).toBe(EMPTY_REVIEW);
    expect(removeMissed(labels, A).missed).toEqual([B]);
  });

  it('прогресс — сколько найденных отмечено', () => {
    const labels = toggleVerdict(EMPTY_REVIEW, A, 'rejected');
    expect(reviewProgress(labels, [A, B])).toEqual({ done: 1, total: 2 });
  });
});
