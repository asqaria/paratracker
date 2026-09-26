import type { GlideDto, ThermalDto } from '@skyline/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useLocaleStore } from '../i18n/locale';
import { messages, type MessageKey } from '../i18n/messages';
import { AnalyticsPanel } from './AnalyticsPanel';
import type { AnalyticsState, FlightAnalytics } from './flight-analytics';
import { glideRatioText, windText } from './format-analytics';
import { metres, verticalSpeed } from './units';

/**
 * Панель проверяется серверным рендером: разметка, цифры и выделение текущего
 * сегмента. Локаль — начальная из стора (при серверном рендере zustand берёт её),
 * ожидаемые строки — теми же форматтерами.
 */

const { locale } = useLocaleStore.getInitialState();
const text = messages[locale];
const t = (key: MessageKey): string => text[key];

const START_MS = Date.UTC(2026, 6, 15, 10);
const iso = (offsetS: number): string => new Date(START_MS + offsetS * 1000).toISOString();
const timeline = { startMs: START_MS, endMs: START_MS + 3600_000, pointCount: 3601 };

const thermal = (seq: number, startS: number, endS: number, avgClimbMs: number): ThermalDto => ({
  seq,
  startedAt: iso(startS),
  endedAt: iso(endS),
  durationS: endS - startS,
  entryAltM: 1500,
  exitAltM: 1500 + Math.round(avgClimbMs * (endS - startS)),
  gainM: Math.round(avgClimbMs * (endS - startS)),
  avgClimbMs,
  maxClimbMs: avgClimbMs * 2,
  turnCount: 5,
  avgRadiusM: 30,
  direction: 'cw',
  efficiency: 0.5,
  strength: 'medium',
  entry: { lat: 43.2, lon: 76.9 },
  exit: { lat: 43.21, lon: 76.91 },
  drift: null,
});

const glide = (seq: number, startS: number, endS: number, ratio: number | null): GlideDto => ({
  seq,
  startedAt: iso(startS),
  endedAt: iso(endS),
  distanceM: 3700,
  altLossM: ratio === null ? 10 : Math.round(3700 / ratio),
  glideRatio: ratio,
  kind: ratio === null ? 'dynamic' : 'glide',
  avgSpeedMs: 10,
  headingDeg: 90,
  headingConsistency: 0.9,
});

const analytics = (overrides: Partial<FlightAnalytics['details']> = {}): FlightAnalytics => ({
  details: {
    flightId: '11111111-2222-4333-8444-555555555555',
    status: 'ready',
    analysisLevel: 'full',
    startedAt: iso(0),
    endedAt: iso(3600),
    durationS: 3600,
    thermalCount: 2,
    avgClimbMs: 1.61,
    avgGlideRatio: 6.69,
    wind: { dirDeg: 44, speedMs: 3.63 },
    ...overrides,
  },
  thermals: [thermal(0, 490, 1160, 1.67), thermal(1, 1345, 1627, 3.4)],
  glides: [glide(0, 18, 490, 7.1), glide(1, 1160, 1345, null)],
  wind: { flight: { dirDeg: 44, speedMs: 3.63 }, profile: [] },
});

const render = (state: AnalyticsState, timeMs = START_MS, tab: 'thermals' | 'glides' = 'thermals', open = true): string =>
  renderToString(
    <AnalyticsPanel state={state} timeline={timeline} timeMs={timeMs} defaultOpen={open} defaultTab={tab} onSelect={() => {}} />,
  );

const ready = (details: Partial<FlightAnalytics['details']> = {}): AnalyticsState => ({ status: 'ready', analytics: analytics(details) });

describe('AnalyticsPanel', () => {
  it('свёрнута по умолчанию: только кнопка — прогрессивное раскрытие (ТЗ §8.1)', () => {
    const html = render(ready(), START_MS, 'thermals', false);
    expect(html).toContain(text['viewer.analytics']);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(text['viewer.analytics.thermalCount']);
  });

  it('раскрытая: цифры полёта — термиков, лучший, средние, ветер румбом и км/ч', () => {
    const html = render(ready());
    expect(html).toContain('aria-expanded="true"');
    // Только блок цифр: те же числа встречаются и в строках списка.
    const stats = /data-analytics="stats"[^>]*>(.*?)<\/dl>/.exec(html)?.[1] ?? '';
    const escape = (value: string): string => value.replaceAll('+', '&#x2B;');
    const has = (value: string): boolean => stats.includes(value) || stats.includes(escape(value));
    expect(has(verticalSpeed(3.4, locale, t))).toBe(true); // лучший — по среднему набору термика
    expect(has(verticalSpeed(1.61, locale, t))).toBe(true); // средний по полёту
    expect(has(glideRatioText(6.69, locale))).toBe(true);
    expect(has(windText({ dirDeg: 44, speedMs: 3.63 }, locale, t))).toBe(true);
  });

  it('список термиков: время от старта, набор, средний набор, длительность', () => {
    const html = render(ready());
    expect(html).toContain('00:08:10');
    expect(html).toContain(metres(1119, locale, t));
    expect(html).toContain('11:10');
  });

  it('текущий сегмент выделен: время внутри термика — его строка aria-current', () => {
    const html = render(ready(), START_MS + 1400_000);
    const current = html.match(/<button[^>]*aria-current="true"[^>]*>/g) ?? [];
    expect(current).toHaveLength(1);
    expect(html.indexOf('aria-current="true"')).toBeGreaterThan(html.indexOf('00:08:10'));
  });

  it('глайды: у dynamic качество прочерком', () => {
    const html = render(ready(), START_MS, 'glides');
    expect(html).toContain(glideRatioText(7.1, locale));
    expect(html).toContain(glideRatioText(null, locale));
  });

  it('трек basic — объяснение вместо списков', () => {
    const html = render(ready({ analysisLevel: 'basic', thermalCount: null, avgClimbMs: null, avgGlideRatio: null, wind: null }));
    expect(html).toContain(text['viewer.analytics.basic']);
  });

  it('загрузка и ошибка — своими строками', () => {
    expect(render({ status: 'loading' })).toContain(text['viewer.analytics.loading']);
    expect(render({ status: 'error' })).toContain(text['viewer.analytics.error']);
  });
});
