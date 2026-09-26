import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useLocaleStore } from '../i18n/locale';
import { messages } from '../i18n/messages';
import { UserMenuView } from './UserMenu';

const { locale } = useLocaleStore.getInitialState();
const t = messages[locale];

const ME = {
  id: '11111111-2222-4333-8444-555555555555',
  username: 'asqar',
  displayName: 'Асқар',
  avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
  locale: 'ru',
  units: 'metric',
} as const;

const render = (props: Partial<Parameters<typeof UserMenuView>[0]>) =>
  renderToString(
    <UserMenuView me={undefined} providers={{ google: true }} onSignOut={() => undefined} currentHash="#/" {...props} />,
  );

describe('UserMenuView', () => {
  it('пока неизвестно, вошёл ли, — пусто: кнопка не мигает', () => {
    expect(render({ me: undefined })).toBe('');
  });

  it('не вошёл — ссылка входа через Google с возвратом на текущий экран', () => {
    const html = render({ me: null, currentHash: '#/flight/abc' });
    expect(html).toContain(t['auth.signIn']);
    expect(html).toContain('href="/api/v1/auth/oauth/google?returnTo=%23%2Fflight%2Fabc"');
  });

  it('Google на сервере не настроен — кнопки нет', () => {
    expect(render({ me: null, providers: { google: false } })).toBe('');
  });

  it('вошёл — аватар, имя и выход', () => {
    const html = render({ me: ME });
    expect(html).toContain('Асқар');
    expect(html).toContain('src="https://lh3.googleusercontent.com/a/photo"');
    expect(html).toContain(t['auth.signOut']);
    expect(html).not.toContain(t['auth.signIn']);
  });

  it('без имени — username, без аватара — без картинки', () => {
    const html = render({ me: { ...ME, displayName: null, avatarUrl: null } });
    expect(html).toContain('asqar');
    expect(html).not.toContain('<img');
  });
});
