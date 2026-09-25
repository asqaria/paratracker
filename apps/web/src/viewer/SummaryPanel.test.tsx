import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useLocaleStore } from '../i18n/locale';
import { messages } from '../i18n/messages';
import { formatSummary } from './format-summary';
import { SummaryPanel } from './SummaryPanel';

/**
 * Серверный рендер берёт начальное состояние стора, а не setState, поэтому
 * язык — тот, что стор выбрал при старте. Единицы по языкам проверяет
 * format-summary.test.ts.
 */

const SUMMARY = { durationS: 959, maxAltM: 3190, distanceTrackM: 17_100, maxGainM: 840 };

describe('SummaryPanel', () => {
  const { locale } = useLocaleStore.getInitialState();
  const html = renderToString(<SummaryPanel summary={SUMMARY} />);

  it('четыре метрики с подписями из i18n', () => {
    for (const key of [
      'viewer.summary.duration',
      'viewer.summary.maxAlt',
      'viewer.summary.distance',
      'viewer.summary.maxGain',
    ] as const) {
      expect(html).toContain(messages[locale][key]);
    }
  });

  it('значения — отформатированная сводка', () => {
    const formatted = formatSummary(SUMMARY, locale, (key) => messages[locale][key]);
    for (const value of Object.values(formatted)) expect(html).toContain(value);
  });

  it('цифры моноширинные табличные (ТЗ §8.4)', () => {
    expect(html.match(/class="([^"]*)"/g)?.some((c) => c.split(/[" ]/).includes('numeric'))).toBe(true);
  });

  it('панель подписана для скринридера', () => {
    expect(html).toContain(`aria-label="${messages[locale]['viewer.summary']}"`);
  });
});
