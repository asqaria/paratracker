import { describe, expect, it } from 'vitest';

import { SITE } from './constants.js';
import { siteSlug } from './site.js';

describe('siteSlug', () => {
  it('латиница — в нижний регистр через дефисы', () => {
    expect(siteSlug('Ush Konyr')).toBe('ush-konyr');
    expect(siteSlug('  Chon-Tash (north)  ')).toBe('chon-tash-north');
  });

  it('кириллица, в том числе казахские буквы, — транслитом', () => {
    expect(siteSlug('Уш-Коныр')).toBe('ush-konyr');
    expect(siteSlug('Көктөбе')).toBe('koktobe');
    expect(siteSlug('Шымбұлақ')).toBe('shymbulak');
    expect(siteSlug('Ақсай ғұмыры')).toBe('aksay-gumyry');
  });

  it('пустое после чистки — запасное имя; длинное — обрезано по дефису', () => {
    expect(siteSlug('???')).toBe('site');
    const long = siteSlug('a'.repeat(30) + ' ' + 'b'.repeat(30) + ' ' + 'c'.repeat(30));
    expect(long.length).toBeLessThanOrEqual(SITE.slugMaxLength);
    expect(long.endsWith('-')).toBe(false);
  });
});
