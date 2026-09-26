import { describe, expect, it } from 'vitest';

import { ProfilePatch, Username } from './profile-dto.js';

describe('Username — адрес профиля /u/{имя}', () => {
  it('строчными; пробелы по краям — прочь', () => {
    expect(Username.parse('  Turar.I ')).toBe('turar.i');
    expect(Username.parse('pilot-2')).toBe('pilot-2');
  });

  it.each(['ab', 'a'.repeat(25), '-pilot', 'pilot.', 'пилот', 'a b', 'x/y'])('не имя: %j', (value) => {
    expect(Username.safeParse(value).success).toBe(false);
  });
});

describe('ProfilePatch', () => {
  it('любое подмножество полей; null у имени — вернуть логин', () => {
    expect(ProfilePatch.parse({ displayName: ' Асқар ' })).toEqual({ displayName: 'Асқар' });
    expect(ProfilePatch.parse({ displayName: null, defaultPrivacy: 'public' })).toEqual({
      displayName: null,
      defaultPrivacy: 'public',
    });
  });

  it('чужие поля и пустое имя — ошибка', () => {
    expect(ProfilePatch.safeParse({ email: 'a@b.kz' }).success).toBe(false);
    expect(ProfilePatch.safeParse({ displayName: '   ' }).success).toBe(false);
  });
});
