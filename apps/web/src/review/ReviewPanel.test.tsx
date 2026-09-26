import type { ThermalDto, ThermalReviewLabels } from '@skyline/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useLocaleStore } from '../i18n/locale';
import { messages } from '../i18n/messages';
import { ReviewPanelView } from './ReviewPanel';

const { locale } = useLocaleStore.getInitialState();
const text = messages[locale];
const T0 = Date.UTC(2026, 6, 15, 9);
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();
const FLIGHT = '22222222-2222-4333-8444-555555555555';

const thermal = (seq: number, startS: number, endS: number): ThermalDto => ({
  seq,
  startedAt: iso(startS),
  endedAt: iso(endS),
  durationS: endS - startS,
  entryAltM: 1500,
  exitAltM: 1900,
  gainM: 400,
  avgClimbMs: 1.8,
  maxClimbMs: 3,
  turnCount: 5,
  avgRadiusM: 45,
  direction: 'cw',
  efficiency: 0.8,
  strength: 'medium',
  entry: { lat: 43.2, lon: 76.9 },
  exit: { lat: 43.21, lon: 76.91 },
  drift: null,
});

const ONE_CONFIRMED: ThermalReviewLabels = { confirmed: [{ startMs: T0 + 490_000, endMs: T0 + 1_157_000 }], rejected: [], missed: [] };

const render = (labels: ThermalReviewLabels = ONE_CONFIRMED) =>
  renderToString(
    <ReviewPanelView
      flightId={FLIGHT}
      thermals={[thermal(0, 490, 1157), thermal(1, 1345, 1627)]}
      labels={labels}
      saveState="saved"
      failed={false}
      timeline={{ startMs: T0, endMs: T0 + 3_600_000, pointCount: 3601 }}
      timeMs={T0}
      onChange={() => undefined}
      onSelect={() => undefined}
    />,
  );

describe('ReviewPanelView', () => {
  it('прогресс «отмечено 1 из 2» и отмеченный термик нажат', () => {
    const html = render();
    expect(html).toContain('1');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
  });

  it('пропущенные — список с временем от начала; ссылка выгрузки разметки', () => {
    const html = render({
      confirmed: [],
      rejected: [],
      missed: [{ startMs: T0 + 6259_000, endMs: T0 + 6940_000 }],
    });
    expect(html).toContain('01:44:19');
    expect(html).toContain(`href="/api/v1/flights/${FLIGHT}/review/labels.json"`);
    expect(html).toContain(text['review.missedStart']);
  });
});
