import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useLocaleStore } from '../i18n/locale';
import { messages } from '../i18n/messages';
import type { DecodedTrack } from './decode-track';
import { FilmOverlay } from './FilmOverlay';

/**
 * Титры фильма (задача 4.3). Серверный рендер: какие карточки на месте и
 * какие у них тексты; видимость — прозрачностью (opacity-100 / opacity-0).
 */

const COUNT = 600;
const track: DecodedTrack = {
  pointCount: COUNT,
  t: Float64Array.from({ length: COUNT }, (_, s) => Date.UTC(2026, 6, 15, 6) + s * 1000),
  lat: new Float64Array(COUNT).fill(43.1),
  lon: new Float64Array(COUNT).fill(76.4),
  alt: Float64Array.from({ length: COUNT }, (_, s) => 2000 + s),
  vSpeed: new Float64Array(COUNT).fill(1.5),
  // Первые и последние 10 с стоим — взлёт и посадка внутри.
  gSpeed: Float64Array.from({ length: COUNT }, (_, s) => (s < 10 || s > COUNT - 10 ? 0 : 10)),
  heading: new Float64Array(COUNT),
  flags: new Uint8Array(COUNT),
  summary: { durationS: COUNT, maxAltM: 2599, distanceTrackM: 5400, maxGainM: 580 },
};

const { locale } = useLocaleStore.getInitialState();
const m = messages[locale];

const render = (card: 'opening' | 'caption' | 'closing' | 'none', facts: Parameters<typeof FilmOverlay>[0]['facts']) =>
  renderToString(<FilmOverlay card={card} facts={facts} details={null} track={track} timeMs={track.t[300] ?? 0} />);

/** Классы блока с data-film="…": видим ли он сейчас. */
const visible = (html: string, name: string): boolean => {
  const at = html.indexOf(`data-film="${name}"`);
  const open = html.lastIndexOf('<div', at);
  const parentOpen = html.lastIndexOf('<div', open - 1);
  const classes = html.slice(parentOpen, at);
  return classes.includes('opacity-100');
};

describe('FilmOverlay', () => {
  it('заставка: без аналитики — «Полёт» и дата; видна только на своей карточке', () => {
    const html = render('opening', null);
    expect(html).toContain(m['film.flight']);
    expect(visible(html, 'opening')).toBe(true);
    expect(visible(html, 'closing')).toBe(false);
  });

  it('подпись термика: название сцены и «+набор · подъём»', () => {
    const html = render('caption', { kind: 'bestThermal', gainM: 1100, climbMs: 1.2 });
    expect(html).toContain(m['film.scene.bestThermal']);
    expect(html).toMatch(/\+1100/);
  });

  it('итоги: четыре цифры полёта и «Skyline»; без XC — макс. набор', () => {
    const html = render('closing', { kind: 'landing' });
    for (const key of ['film.closing.airtime', 'film.closing.distance', 'film.closing.maxAlt', 'film.closing.gain'] as const) {
      expect(html).toContain(m[key]);
    }
    expect(html).toContain(m['app.name']);
    expect(visible(html, 'closing')).toBe(true);
  });

  it('всё время — мини-график высоты и живые цифры моноширинным', () => {
    const html = render('none', null);
    expect(html).toContain('data-film="chart"');
    expect(html).toMatch(/data-film="hud" class="[^"]*numeric/);
  });
});
