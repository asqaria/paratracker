import type { LogbookEntry } from '@skyline/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { COMPARE_MAX_FLIGHTS } from '../compare/compare-refs';
import { LogbookList } from './LogbookList';

const entry = (n: number, status: LogbookEntry['status'] = 'ready'): LogbookEntry => ({
  id: `11111111-2222-4333-8444-${String(n).padStart(12, '0')}`,
  status,
  startedAt: '2026-07-15T06:00:00.000Z',
  uploadedAt: '2026-07-15T08:00:00.000Z',
  timezone: 'Asia/Almaty',
  durationS: 3600,
  distanceTrackM: 20_000,
  maxAltM: 3000,
  thermalCount: 4,
  takeoffSite: null,
  glider: null,
});

const render = (items: LogbookEntry[], selected: string[] = []) =>
  renderToString(
    <LogbookList
      items={items}
      hasMore={false}
      loadingMore={false}
      onMore={() => undefined}
      selected={new Set(selected)}
      onToggle={() => undefined}
    />,
  );

const checkboxes = (html: string): string[] => html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];

describe('LogbookList — выбор для сравнения (задача 3.12)', () => {
  it('галочка — только у готовых полётов', () => {
    expect(checkboxes(render([entry(1), entry(2, 'parsing'), entry(3, 'failed')]))).toHaveLength(1);
  });

  it(`отмечено ${COMPARE_MAX_FLIGHTS} — остальные недоступны, отмеченные можно снять`, () => {
    const items = Array.from({ length: COMPARE_MAX_FLIGHTS + 1 }, (_, i) => entry(i + 1));
    const boxes = checkboxes(render(items, items.slice(0, COMPARE_MAX_FLIGHTS).map((item) => item.id)));
    expect(boxes.filter((box) => box.includes('disabled'))).toHaveLength(1);
    expect(boxes.filter((box) => box.includes('checked'))).toHaveLength(COMPARE_MAX_FLIGHTS);
  });
});
