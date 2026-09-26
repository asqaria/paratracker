/**
 * Шторка просмотрщика на телефоне (ТЗ §8.3) — расчёт без DOM: высоты трёх
 * положений и куда встать, когда палец отпустил ручку.
 */

export const SHEET_SNAPS = ['peek', 'half', 'full'] as const;
export type SheetSnap = (typeof SHEET_SNAPS)[number];

export const SHEET = {
  /**
   * Свёрнута — только ручка со строкой сводки: 48 px (цель касания 44 по
   * WCAG 2.5.5 плюс рамка). Сводка четырьмя подписанными цифрами занимала
   * лишние 44 px — на телефоне сцене нужна высота.
   */
  peekPx: 48,
  /**
   * Сверху над раскрытой шторкой остаётся место: легенда варио (она едет вместе
   * со шторкой) и полоска сцены — видно, что под шторкой просмотрщик. Не больше
   * доли доступного места: телефон лёжа (390 px в высоту) иначе не раскрывал бы
   * шторку вовсе.
   */
  topGapPx: 96,
  topGapFraction: 0.15,
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
  const gap = Math.min(SHEET.topGapPx, availablePx * SHEET.topGapFraction);
  const full = Math.max(peek, Math.round(availablePx - gap));
  // Половина — посередине между свёрнутой и полной: на любом экране три разных положения.
  const half = Math.round((peek + full) / 2);
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
