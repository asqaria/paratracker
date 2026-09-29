import { describe, expect, it } from 'vitest';

import { kk7Layer, kk7Season, kk7TimeOfDay, kk7TileUrl } from './kk7';

const USH = { lat: 43.127, lon: 76.465 };

describe('kk7Season — сезоны карты термиков', () => {
  it('декабрь–февраль — jan, март–май — apr, июнь–август — jul, сентябрь–ноябрь — oct', () => {
    expect([11, 0, 1].map(kk7Season)).toEqual(['jan', 'jan', 'jan']);
    expect([2, 3, 4].map(kk7Season)).toEqual(['apr', 'apr', 'apr']);
    expect([5, 6, 7].map(kk7Season)).toEqual(['jul', 'jul', 'jul']);
    expect([8, 9, 10].map(kk7Season)).toEqual(['oct', 'oct', 'oct']);
  });
});

describe('kk7TimeOfDay — время суток от восхода', () => {
  it('до 6 ч после восхода — утро, 6–9 ч — день, позже — вечер; ночью — null', () => {
    // Восход в Алматы 30.09 ≈ 06:55 местного (01:55 UTC).
    expect(kk7TimeOfDay(USH.lat, USH.lon, Date.UTC(2026, 8, 30, 4))).toBe('04');
    expect(kk7TimeOfDay(USH.lat, USH.lon, Date.UTC(2026, 8, 30, 9))).toBe('07');
    expect(kk7TimeOfDay(USH.lat, USH.lon, Date.UTC(2026, 8, 30, 12))).toBe('10');
    expect(kk7TimeOfDay(USH.lat, USH.lon, Date.UTC(2026, 8, 30, 20))).toBeNull();
  });
});

describe('kk7Layer и адрес тайлов', () => {
  it('термики — сезон и время суток выбранного часа; ночью — весь день', () => {
    expect(kk7Layer('thermals', USH.lat, USH.lon, Date.UTC(2026, 8, 30, 9))).toBe('thermals_oct_07');
    expect(kk7Layer('thermals', USH.lat, USH.lon, Date.UTC(2026, 6, 15, 20))).toBe('thermals_jul_all');
    expect(kk7Layer('skyways', USH.lat, USH.lon, Date.UTC(2026, 8, 30, 9))).toBe('skyways_oct_07');
  });

  it('шаблон из конфига: подставляется слой, {z}/{x}/{y} остаются MapLibre', () => {
    expect(kk7TileUrl('https://kk7.example/tiles/{layer}/{z}/{x}/{y}.png?src=skyline', 'thermals_oct_07')).toBe(
      'https://kk7.example/tiles/thermals_oct_07/{z}/{x}/{y}.png?src=skyline',
    );
  });
});
