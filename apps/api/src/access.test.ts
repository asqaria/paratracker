import { describe, expect, it } from 'vitest';

import { shareOf, viewOf } from './access.js';

const OWNER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
const flight = (privacy: 'public' | 'unlisted' | 'private', shareToken: string | null = 'tok') => ({
  userId: OWNER,
  privacy,
  shareToken,
});

describe('viewOf', () => {
  it('владелец видит всё при любой видимости', () => {
    for (const privacy of ['public', 'unlisted', 'private'] as const) {
      expect(viewOf(flight(privacy), OWNER, undefined)).toBe('owner');
    }
  });

  it('анонимная загрузка — как у владельца: её открывают по id сразу после загрузки', () => {
    expect(viewOf({ userId: null, privacy: 'unlisted', shareToken: null }, null, undefined)).toBe('owner');
  });

  it('публичный — любому, без ссылки', () => {
    expect(viewOf(flight('public'), null, undefined)).toBe('viewer');
    expect(viewOf(flight('public'), OTHER, undefined)).toBe('viewer');
  });

  it('«по ссылке» — только с верным токеном', () => {
    expect(viewOf(flight('unlisted'), OTHER, 'tok')).toBe('viewer');
    expect(viewOf(flight('unlisted'), OTHER, 'wrong')).toBeNull();
    expect(viewOf(flight('unlisted'), OTHER, undefined)).toBeNull();
    // Токена ещё нет — ссылку не выдавали, никакой «пустой» токен не подходит.
    expect(viewOf(flight('unlisted', null), OTHER, '')).toBeNull();
  });

  it('«только я» — никому, даже с токеном', () => {
    expect(viewOf(flight('private'), OTHER, 'tok')).toBeNull();
  });
});

describe('shareOf', () => {
  it('токен из ?share=, пустой и не строка — нет токена', () => {
    expect(shareOf({ share: 'abc' })).toBe('abc');
    expect(shareOf({ share: '' })).toBeUndefined();
    expect(shareOf({ share: ['a', 'b'] })).toBeUndefined();
    expect(shareOf({})).toBeUndefined();
  });
});
