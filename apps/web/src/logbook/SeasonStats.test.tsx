import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useLocaleStore } from '../i18n/locale';
import { messages } from '../i18n/messages';
import { formatDuration } from '../viewer/format-summary';
import { kilometres } from '../viewer/units';
import { SeasonStatsView } from './SeasonStats';

const { locale } = useLocaleStore.getInitialState();
const text = messages[locale];
const t = (key: keyof typeof text) => text[key];

const STATS = {
  year: 2026,
  years: [2026, 2025],
  totals: { flights: 3, airtimeS: 10_800, distanceM: 55_000, gainM: 1900, maxAltM: 3200, longestAirtimeS: 5400, longestDistanceM: 40_000 },
  byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, flights: i === 4 ? 3 : 0, airtimeS: i === 4 ? 10_800 : 0, distanceM: 0 })),
  topSites: [{ id: '33333333-2222-4333-8444-555555555555', name: 'Ush Konyr', countryCode: 'kz', source: 'seed' as const, flights: 3, airtimeS: 10_800 }],
};

describe('SeasonStatsView', () => {
  const html = renderToString(<SeasonStatsView stats={STATS} onYear={() => undefined} />);

  it('итоги сезона — в единицах пилота', () => {
    expect(html).toContain(formatDuration(10_800, t));
    expect(html).toContain(kilometres(55_000, locale, t));
    expect(html).toContain(text['stats.longest']);
  });

  it('переключатель лет, текущий выбран', () => {
    expect(html).toContain('<option value="2026" selected="">2026</option>');
    expect(html).toContain('<option value="2025">2025</option>');
  });

  it('12 столбцов по месяцам: самый активный — во всю высоту, пустые — нулевые', () => {
    expect(html.match(/<rect /g)).toHaveLength(12);
    expect(html).toContain('y="0" width="10" height="40"');
    expect(html).toContain('height="0"');
  });

  it('топ мест', () => {
    expect(html).toContain('Ush Konyr');
  });

  it('пилот ещё не летал: прочерки вместо рекордов, без переключателя', () => {
    const empty = renderToString(
      <SeasonStatsView
        stats={{
          ...STATS,
          year: null,
          years: [],
          totals: { flights: 0, airtimeS: 0, distanceM: 0, gainM: 0, maxAltM: null, longestAirtimeS: null, longestDistanceM: null },
          topSites: [],
        }}
        onYear={() => undefined}
      />,
    );
    expect(empty).toContain('—');
    expect(empty).not.toContain('<select');
  });
});
