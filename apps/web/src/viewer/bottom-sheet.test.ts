import { describe, expect, it } from 'vitest';

import { SHEET, SHEET_SNAPS, sheetHeights, snapAfterDrag, toggleSnap } from './bottom-sheet';

/** Шторка на телефоне (ТЗ §8.3): три положения — свёрнута, половина, весь экран. */

describe('sheetHeights', () => {
  it('свёрнута — ручка и сводка; весь экран — доступное место без зазора сверху; половина — половина его', () => {
    const heights = sheetHeights(600);
    expect(heights.peek).toBe(SHEET.peekPx);
    expect(heights.full).toBe(600 - SHEET.topGapPx);
    expect(heights.half).toBe(Math.round((600 - SHEET.topGapPx) * SHEET.halfFraction));
  });

  it('раскрытая шторка не выходит за доступное место — ручка остаётся на экране', () => {
    expect(sheetHeights(600).full).toBeLessThanOrEqual(600);
  });

  it('низкий экран (телефон лёжа) — положения не ниже свёрнутой и по порядку', () => {
    const heights = sheetHeights(150);
    expect(heights.half).toBeGreaterThanOrEqual(heights.peek);
    expect(heights.full).toBeGreaterThanOrEqual(heights.half);
  });
});

describe('snapAfterDrag', () => {
  const heights = sheetHeights(700);

  it('медленно отпустили — ближайшее положение', () => {
    expect(snapAfterDrag(heights, heights.half + 20, 0)).toBe('half');
    expect(snapAfterDrag(heights, heights.peek + 30, 0)).toBe('peek');
    expect(snapAfterDrag(heights, heights.full - 40, 0)).toBe('full');
  });

  it('рывок вверх — следующее выше того, что под пальцем; вниз — ниже', () => {
    const flick = SHEET.flickPxPerMs * 2;
    expect(snapAfterDrag(heights, heights.peek + 10, flick)).toBe('half');
    expect(snapAfterDrag(heights, heights.half + 10, flick)).toBe('full');
    expect(snapAfterDrag(heights, heights.half - 10, -flick)).toBe('peek');
    expect(snapAfterDrag(heights, heights.full - 10, -flick)).toBe('half');
  });

  it('рывок за край — остаётся крайним', () => {
    const flick = SHEET.flickPxPerMs * 2;
    expect(snapAfterDrag(heights, heights.full, flick)).toBe('full');
    expect(snapAfterDrag(heights, heights.peek, -flick)).toBe('peek');
  });
});

describe('toggleSnap', () => {
  it('тап по ручке: свёрнута ↔ половина; из полного — в свёрнутую', () => {
    expect(toggleSnap('peek')).toBe('half');
    expect(toggleSnap('half')).toBe('peek');
    expect(toggleSnap('full')).toBe('peek');
    expect(SHEET_SNAPS).toEqual(['peek', 'half', 'full']);
  });
});
