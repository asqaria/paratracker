import { describe, expect, it } from 'vitest';

import { messages } from '../i18n/messages';
import { groundSpeed, kilometres, metres, verticalSpeed, type Translate } from './units';

const ru: Translate = (key) => messages.ru[key];
const en: Translate = (key) => messages.en[key];

describe('metres', () => {
  it('целые, без разрядов', () => {
    expect(metres(3190.4, 'ru', ru)).toBe('3190 м');
    expect(metres(3190.6, 'en', en)).toBe('3191 m');
  });

  it('нет значения — прочерк', () => {
    expect(metres(Number.NaN, 'ru', ru)).toBe('—');
  });
});

describe('kilometres', () => {
  it('из метров, один знак, разделитель по локали', () => {
    expect(kilometres(17_100.025, 'ru', ru)).toBe('17,1 км');
    expect(kilometres(17_100.025, 'en', en)).toBe('17.1 km');
    expect(kilometres(40, 'ru', ru)).toBe('0,0 км');
  });
});

describe('verticalSpeed', () => {
  it('со знаком и одним знаком после запятой', () => {
    expect(verticalSpeed(1.75, 'ru', ru)).toBe('+1,8 м/с');
    expect(verticalSpeed(-2.44, 'ru', ru)).toBe('-2,4 м/с');
    expect(verticalSpeed(2.4, 'en', en)).toBe('+2.4 m/s');
  });

  it('ноль — с плюсом, как на приборах', () => {
    expect(verticalSpeed(0, 'ru', ru)).toBe('+0,0 м/с');
  });

  it('нет значения — прочерк', () => {
    expect(verticalSpeed(Number.NaN, 'en', en)).toBe('—');
  });
});

describe('groundSpeed', () => {
  it('м/с внутри → км/ч на экране (ТЗ §8.4), целые', () => {
    expect(groundSpeed(20, 'ru', ru)).toBe('72 км/ч');
    expect(groundSpeed(11.6, 'en', en)).toBe('42 km/h');
  });

  it('нет значения — прочерк', () => {
    expect(groundSpeed(Number.NaN, 'ru', ru)).toBe('—');
  });
});
