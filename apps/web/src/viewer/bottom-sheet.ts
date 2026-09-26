/**
 * Шторка просмотрщика на телефоне (ТЗ §8.3) — расчёт без DOM: высоты трёх
 * положений и куда встать, когда палец отпустил ручку.
 */

export const SHEET_SNAPS = ['peek', 'half', 'full'] as const;
export type SheetSnap = (typeof SHEET_SNAPS)[number];

export const SHEET = {
  /** Свёрнута: ручка (20 px) и строка сводки (4 цифры, ~44 px) плюс отступы. */
  peekPx: 76,
  /**
   * Сверху над раскрытой шторкой остаётся место: легенда варио (она едет вместе
   * со шторкой) и полоска сцены — видно, что под шторкой просмотрщик.
   */
  topGapPx: 96,
  /** Половина — доля доступной высоты: сцена сверху остаётся главной. */
  halfFraction: 0.5,
  /** Быстрее, px/мс, — рывок: шторка уходит в следующее положение по направлению. */
  flickPxPerMs: 0.5,
} as const;

export type SheetHeights = Record<SheetSnap, number>;

/**
 * Высоты положений; availablePx — от низа шторки до верха экрана. Под шторкой
 * таймлайн и атрибуция: доля высоты окна выводила раскрытую шторку за верх
 * экрана вместе с ручкой. Каждое положение не ниже предыдущего.
 */
export function sheetHeights(availablePx: number): SheetHeights {
  const peek = SHEET.peekPx;
  const full = Math.max(peek, Math.round(availablePx - SHEET.topGapPx));
  const half = Math.max(peek, Math.min(full, Math.round(full * SHEET.halfFraction)));
  return { peek, half, full };
}

/**
 * Куда встать после перетаскивания: высота в момент отпускания и скорость
 * (px/мс, плюс — вверх). Рывок — следующее положение по направлению от
 * текущей высоты; иначе — ближайшее.
 */
export function snapAfterDrag(heights: SheetHeights, heightPx: number, velocityPxPerMs: number): SheetSnap {
  if (Math.abs(velocityPxPerMs) >= SHEET.flickPxPerMs) {
    const up = velocityPxPerMs > 0;
    const candidates = up
      ? SHEET_SNAPS.filter((snap) => heights[snap] > heightPx)
      : [...SHEET_SNAPS].reverse().filter((snap) => heights[snap] < heightPx);
    return candidates[0] ?? (up ? 'full' : 'peek');
  }
  let best: SheetSnap = 'peek';
  for (const snap of SHEET_SNAPS) {
    if (Math.abs(heights[snap] - heightPx) < Math.abs(heights[best] - heightPx)) best = snap;
  }
  return best;
}

/** Тап по ручке: из свёрнутой — в половину, из раскрытой — свернуть. */
export const toggleSnap = (snap: SheetSnap): SheetSnap => (snap === 'peek' ? 'half' : 'peek');
