import { describe, expect, it } from 'vitest';

import { ClaimRequest, LOGBOOK_PAGE, LogbookMapResponse, LogbookQuery } from './logbook-dto.js';

describe('LogbookQuery', () => {
  it('limit по умолчанию и из строки запроса', () => {
    expect(LogbookQuery.parse({})).toEqual({ limit: LOGBOOK_PAGE.defaultLimit });
    expect(LogbookQuery.parse({ limit: '10', from: '2026-05-01' })).toEqual({ limit: 10, from: '2026-05-01' });
  });

  it('лимит сверх потолка и кривую дату не принимает', () => {
    expect(LogbookQuery.safeParse({ limit: String(LOGBOOK_PAGE.maxLimit + 1) }).success).toBe(false);
    expect(LogbookQuery.safeParse({ from: '01.05.2026' }).success).toBe(false);
  });
});

describe('LogbookMapResponse', () => {
  it('линия из одной точки — не линия', () => {
    const feature = (coordinates: number[][]) => ({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id: '11111111-2222-4333-8444-555555555555', startedAt: null },
          geometry: { type: 'LineString', coordinates },
        },
      ],
    });
    expect(LogbookMapResponse.safeParse(feature([[77, 43], [77.1, 43.1]])).success).toBe(true);
    expect(LogbookMapResponse.safeParse(feature([[77, 43]])).success).toBe(false);
  });
});

describe('ClaimRequest', () => {
  it('пустой список и не-uuid не принимает', () => {
    expect(ClaimRequest.safeParse({ claims: [] }).success).toBe(false);
    expect(ClaimRequest.safeParse({ claims: [{ flightId: 'x', token: 't' }] }).success).toBe(false);
  });
});
