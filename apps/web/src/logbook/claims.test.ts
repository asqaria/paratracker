import { CLAIM, RETENTION, TIME } from '@skyline/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { forgetClaims, hasClaim, pendingClaims, rememberClaim, type ClaimStorage } from './claims';

const A = '11111111-2222-4333-8444-555555555555';
const B = '22222222-2222-4333-8444-555555555555';
const NOW = Date.UTC(2026, 8, 26);
const DAY_MS = TIME.secondsPerDay * TIME.msPerSecond;

function memoryStorage(): ClaimStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('токены анонимных загрузок', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it('запоминает, отдаёт и забывает', () => {
    rememberClaim(A, 'token-a', { storage, now: NOW });
    rememberClaim(B, 'token-b', { storage, now: NOW });
    expect(pendingClaims({ storage, now: NOW })).toEqual([
      { flightId: A, token: 'token-a' },
      { flightId: B, token: 'token-b' },
    ]);
    expect(hasClaim(A, { storage, now: NOW })).toBe(true);

    forgetClaims([A], { storage });
    expect(pendingClaims({ storage, now: NOW })).toEqual([{ flightId: B, token: 'token-b' }]);
  });

  it('старше срока хранения анонимного полёта — забыт: сервер его уже удалил', () => {
    rememberClaim(A, 'token-a', { storage, now: NOW });
    const later = NOW + (RETENTION.anonymousDays + 1) * DAY_MS;
    expect(pendingClaims({ storage, now: later })).toEqual([]);
  });

  it('помнит не больше CLAIM.maxFlights — самые новые', () => {
    for (let i = 0; i < CLAIM.maxFlights + 5; i++) {
      rememberClaim(`${String(i).padStart(8, '0')}-2222-4333-8444-555555555555`, `t${i}`, { storage, now: NOW + i });
    }
    const claims = pendingClaims({ storage, now: NOW + CLAIM.maxFlights + 5 });
    expect(claims).toHaveLength(CLAIM.maxFlights);
    expect(claims[0]?.token).toBe('t5');
  });

  it('мусор в хранилище и недоступное хранилище — пусто, без исключений', () => {
    storage.data.set('skyline.claims', '{not json');
    expect(pendingClaims({ storage, now: NOW })).toEqual([]);

    const broken: ClaimStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => rememberClaim(A, 't', { storage: broken, now: NOW })).not.toThrow();
    expect(pendingClaims({ storage: broken, now: NOW })).toEqual([]);
  });
});
