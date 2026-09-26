import type { LogbookEntry } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { messages } from '../i18n/messages';
import { formatEntry, formatLocalStart } from './format-logbook';

const ENTRY: LogbookEntry = {
  id: '11111111-2222-4333-8444-555555555555',
  status: 'ready',
  startedAt: '2026-07-02T23:30:00.000Z',
  uploadedAt: '2026-07-03T10:00:00.000Z',
  timezone: 'Asia/Almaty',
  durationS: 17_280,
  distanceTrackM: 176_800,
  maxAltM: 3505,
  thermalCount: 28,
  takeoffSite: null,
  glider: null,
};

describe('formatEntry', () => {
  const t = (key: keyof (typeof messages)['ru']) => messages.ru[key];

  it('цифры в единицах пилота: км, м, ч мин', () => {
    expect(formatEntry(ENTRY, 'ru', t)).toMatchObject({
      duration: '4 ч 48 мин',
      distance: expect.stringContaining('176,8') as string,
      maxAlt: expect.stringContaining('3505') as string,
      thermals: '28',
    });
  });

  it('дата — по часам места взлёта: 23:30 UTC в Алматы — уже следующий день', () => {
    const en = (key: keyof (typeof messages)['en']) => messages.en[key];
    expect(formatEntry(ENTRY, 'en', en).date).toBe('Jul 3, 2026');
    // Без таймзоны — UTC, а не часы браузера.
    expect(formatEntry({ ...ENTRY, timezone: null }, 'en', en).date).toBe('Jul 2, 2026');
  });

  it('начало полёта — местное время с поясом', () => {
    expect(formatLocalStart(ENTRY.startedAt ?? '', 'Asia/Almaty', 'en')).toBe('Jul 3, 2026, 04:30 AM GMT+5');
  });

  it('полёт в обработке — дата загрузки и прочерки', () => {
    const pending = formatEntry(
      {
        ...ENTRY,
        status: 'pending',
        startedAt: null,
        timezone: null,
        durationS: null,
        distanceTrackM: null,
        maxAltM: null,
        thermalCount: null,
      },
      'en',
      (key) => messages.en[key],
    );
    expect(pending).toEqual({ date: 'Jul 3, 2026', duration: '—', distance: '—', maxAlt: '—', thermals: '—' });
  });
});
