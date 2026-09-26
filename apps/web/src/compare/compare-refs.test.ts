import { describe, expect, it } from 'vitest';

import { COMPARE_MAX_FLIGHTS, compareHash, refFromLink, refsFromQuery, type FlightRef } from './compare-refs';

const A = '11111111-2222-4333-8444-555555555555';
const B = '22222222-2222-4333-8444-555555555555';

describe('refsFromQuery / compareHash — состав сравнения в адресе', () => {
  it('id и токены ссылок; мусор пропускается', () => {
    expect(refsFromQuery(`f=${A},tokenABC_12,!!,${B.toUpperCase()}`)).toEqual([
      { kind: 'id', flightId: A },
      { kind: 'share', token: 'tokenABC_12' },
      { kind: 'id', flightId: B },
    ]);
    expect(refsFromQuery('')).toEqual([]);
  });

  it('дубли убираются, больше 8 — отбрасывается', () => {
    expect(refsFromQuery(`f=${A},${A}`)).toHaveLength(1);
    const many = Array.from({ length: 10 }, (_, i) => `token_${String(i).padStart(4, '0')}`).join(',');
    expect(refsFromQuery(`f=${many}`)).toHaveLength(COMPARE_MAX_FLIGHTS);
  });

  it('адрес и обратно — тот же состав', () => {
    const refs: FlightRef[] = [
      { kind: 'id', flightId: A },
      { kind: 'share', token: 'tokenABC_12' },
    ];
    const hash = compareHash(refs);
    expect(hash).toBe(`#/compare?f=${A},tokenABC_12`);
    expect(refsFromQuery(hash.slice(hash.indexOf('?') + 1))).toEqual(refs);
    expect(compareHash([])).toBe('#/compare');
  });
});

describe('refFromLink — полёт из вставленной ссылки', () => {
  it.each([
    ['https://skyline.gateapp.kz/s/tokenABC_12', { kind: 'share', token: 'tokenABC_12' }],
    ['https://skyline.gateapp.kz/#/s/tokenABC_12', { kind: 'share', token: 'tokenABC_12' }],
    ['https://skyline.gateapp.kz/embed/tokenABC_12/', { kind: 'share', token: 'tokenABC_12' }],
    [`https://skyline.gateapp.kz/#/flight/${A}`, { kind: 'id', flightId: A }],
    [`  ${A}  `, { kind: 'id', flightId: A }],
  ])('%s', (link, ref) => {
    expect(refFromLink(link)).toEqual(ref);
  });

  it.each(['', 'привет', 'https://example.com/', 'https://skyline.gateapp.kz/#/logbook'])('не полёт: %j', (link) => {
    expect(refFromLink(link)).toBeNull();
  });
});
