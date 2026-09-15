import { describe, expect, it } from 'vitest';

import { detectLocale } from './locale';

describe('detectLocale', () => {
  it('берёт первый поддерживаемый язык браузера', () => {
    expect(detectLocale(['kk-KZ', 'ru-RU', 'en-US'])).toBe('ru');
    expect(detectLocale(['EN-gb'])).toBe('en');
  });

  it('падает на английский, если ничего не подошло', () => {
    expect(detectLocale(['de-DE'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });
});
