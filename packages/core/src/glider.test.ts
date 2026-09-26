import { describe, expect, it } from 'vitest';

import { GLIDER, gliderLabel, GliderInput } from './glider.js';

describe('GliderInput', () => {
  it('по умолчанию: без размера и класса, не основное; пробелы обрезаны', () => {
    expect(GliderInput.parse({ manufacturer: ' Ozone ', model: 'Rush 6' })).toEqual({
      manufacturer: 'Ozone',
      model: 'Rush 6',
      size: null,
      certification: null,
      isDefault: false,
    });
  });

  it('пустое имя, чужой класс и длинный размер не принимает', () => {
    expect(GliderInput.safeParse({ manufacturer: ' ', model: 'Rush 6' }).success).toBe(false);
    expect(GliderInput.safeParse({ manufacturer: 'Ozone', model: 'Rush 6', certification: 'EN-E' }).success).toBe(false);
    expect(
      GliderInput.safeParse({ manufacturer: 'Ozone', model: 'Rush 6', size: 'x'.repeat(GLIDER.sizeMaxLength + 1) }).success,
    ).toBe(false);
  });
});

describe('gliderLabel', () => {
  it('производитель, модель и размер через пробел; без размера — без хвоста', () => {
    expect(gliderLabel({ manufacturer: 'Ozone', model: 'Rush 6', size: 'ML' })).toBe('Ozone Rush 6 ML');
    expect(gliderLabel({ manufacturer: 'Gin', model: 'Bonanza 3', size: null })).toBe('Gin Bonanza 3');
  });
});
