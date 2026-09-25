import type { FlightSummary } from '@skyline/core';
import { describe, expect, it } from 'vitest';

import { messages } from '../i18n/messages';
import { formatSummary } from './format-summary';

const summary = (overrides: Partial<FlightSummary> = {}): FlightSummary => ({
  durationS: 959,
  maxAltM: 3190.4,
  distanceTrackM: 17_100.025,
  maxGainM: 839.6,
  ...overrides,
});

const ru = (key: keyof (typeof messages)['ru']): string => messages.ru[key];
const en = (key: keyof (typeof messages)['en']): string => messages.en[key];

describe('formatSummary', () => {
  it('ru: метры целые, километры с одним знаком через запятую', () => {
    expect(formatSummary(summary(), 'ru', ru)).toEqual({
      duration: '16 мин',
      maxAlt: '3190 м',
      distance: '17,1 км',
      maxGain: '840 м',
    });
  });

  it('en: десятичная точка', () => {
    expect(formatSummary(summary(), 'en', en)).toMatchObject({ distance: '17.1 km', maxAlt: '3190 m' });
  });

  it.each([
    [59, '1 мин'],
    [3599, '1 ч 00 мин'],
    [3600, '1 ч 00 мин'],
    [4 * 3600 + 5 * 60 + 29, '4 ч 05 мин'],
    [0, '0 мин'],
  ])('длительность %i с → %s', (durationS, expected) => {
    expect(formatSummary(summary({ durationS }), 'ru', ru).duration).toBe(expected);
  });

  it('длительность en', () => {
    expect(formatSummary(summary({ durationS: 2 * 3600 + 7 * 60 }), 'en', en).duration).toBe('2 h 07 min');
  });

  it('нет высоты — прочерк вместо NaN', () => {
    expect(formatSummary(summary({ maxAltM: Number.NaN }), 'ru', ru).maxAlt).toBe('—');
  });

  it('короткий трек — дистанция всё равно в километрах', () => {
    expect(formatSummary(summary({ distanceTrackM: 40 }), 'ru', ru).distance).toBe('0,0 км');
  });
});
