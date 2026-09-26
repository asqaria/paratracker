import { describe, expect, it } from 'vitest';

import { messages, type MessageKey } from '../i18n/messages';
import { compassPoint, glideRatioText, segmentDuration, windText } from './format-analytics';

const ru = (key: MessageKey): string => messages.ru[key];
const en = (key: MessageKey): string => messages.en[key];

describe('форматирование аналитики', () => {
  it('румб ветра — откуда дует, восемь направлений', () => {
    expect(compassPoint(0, ru)).toBe('С');
    expect(compassPoint(44, ru)).toBe('СВ');
    expect(compassPoint(90, en)).toBe('E');
    expect(compassPoint(200, ru)).toBe('Ю');
    expect(compassPoint(337.6, ru)).toBe('С');
    expect(compassPoint(247, en)).toBe('SW');
  });

  it('ветер: румб и км/ч — внутри м/с, на экране километры в час', () => {
    expect(windText({ dirDeg: 44, speedMs: 3.63 }, 'ru', ru)).toBe('СВ 13 км/ч');
    expect(windText({ dirDeg: 270, speedMs: 5 }, 'en', en)).toBe('W 18 km/h');
    expect(windText(null, 'ru', ru)).toBe('—');
  });

  it('качество — с десятыми по локали; нет качества (dynamic) — прочерк', () => {
    expect(glideRatioText(6.69, 'ru')).toBe('6,7');
    expect(glideRatioText(13.5, 'en')).toBe('13.5');
    expect(glideRatioText(null, 'ru')).toBe('—');
  });

  it('длительность сегмента: м:сс, дольше часа — ч:мм:сс', () => {
    expect(segmentDuration(58)).toBe('0:58');
    expect(segmentDuration(670)).toBe('11:10');
    expect(segmentDuration(3725)).toBe('1:02:05');
  });
});
