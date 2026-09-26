import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { useT } from '../i18n/locale';
import { sheetHeights, snapAfterDrag, toggleSnap, type SheetSnap } from './bottom-sheet';

/**
 * Шторка на телефоне (ТЗ §8.3): три положения — свёрнута, половина, весь экран.
 * Ручку тянут пальцем; отпустили — встаёт в ближайшее положение или, при
 * рывке, в следующее по направлению. Тап по ручке — свёрнута ↔ половина.
 * summary видна всегда (свёрнутая шторка), children — ниже, с прокруткой.
 */

export interface BottomSheetProps {
  summary: ReactNode;
  children: ReactNode;
  defaultSnap?: SheetSnap;
}

interface Drag {
  pointerId: number;
  startY: number;
  startHeight: number;
  lastY: number;
  lastMs: number;
  velocity: number;
  moved: boolean;
}

/** Смещение пальца меньше — это тап, а не перетаскивание. */
const TAP_SLOP_PX = 6;

/** До замера (серверный рендер, первый кадр) — место под шторкой не известно. */
const UNMEASURED_PX = 0;

export function BottomSheet({ summary, children, defaultSnap = 'peek' }: BottomSheetProps) {
  const t = useT();
  const [snap, setSnap] = useState<SheetSnap>(defaultSnap);
  // Доступное место — от низа шторки до верха экрана: под ней таймлайн и атрибуция.
  const [available, setAvailable] = useState(UNMEASURED_PX);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const section = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const measure = (): void => {
      const bottom = section.current?.getBoundingClientRect().bottom;
      if (bottom !== undefined) setAvailable(bottom);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const heights = sheetHeights(available);
  const height = dragHeight ?? heights[snap];
  const clamp = (value: number): number => Math.max(heights.peek, Math.min(heights.full, value));

  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: height,
      lastY: event.clientY,
      lastMs: event.timeStamp,
      velocity: 0,
      moved: false,
    };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientY - current.startY) > TAP_SLOP_PX) current.moved = true;
    if (!current.moved) return;
    const dt = event.timeStamp - current.lastMs;
    // Скорость — вверх положительная: высота растёт, когда палец идёт вверх.
    if (dt > 0) current.velocity = (current.lastY - event.clientY) / dt;
    current.lastY = event.clientY;
    current.lastMs = event.timeStamp;
    setDragHeight(clamp(current.startHeight + (current.startY - event.clientY)));
  };
  const onPointerUp = (event: React.PointerEvent<HTMLElement>): void => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (current.moved) setSnap(snapAfterDrag(heights, dragHeight ?? height, current.velocity));
    else setSnap(toggleSnap(snap));
    setDragHeight(null);
  };

  const expanded = snap !== 'peek';
  return (
    <section
      ref={section}
      aria-label={t('viewer.sheet')}
      data-panel="sheet"
      data-snap={snap}
      style={{ height }}
      className={`flex flex-col overflow-hidden rounded-t-2xl glass ${dragHeight === null ? 'transition-[height] duration-200 ease-out' : ''}`}
    >
      {/* Ручка: тянуть — менять высоту, тап — свернуть или раскрыть. Жесты — шторке, не странице. */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? t('viewer.sheet.collapse') : t('viewer.sheet.expand')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex min-h-6 w-full shrink-0 touch-none items-center justify-center"
      >
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-secondary/60" />
      </button>
      <div className="shrink-0 px-2 pb-2">{summary}</div>
      {/* Свёрнута и не тянется — содержимое скрыто: иначе снизу выглядывал край первой кнопки. */}
      <div
        aria-hidden={!expanded && dragHeight === null}
        className={`min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-2 pb-3 ${!expanded && dragHeight === null ? 'invisible' : ''}`}
      >
        {children}
      </div>
    </section>
  );
}
