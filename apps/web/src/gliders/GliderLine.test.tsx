import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useLocaleStore } from '../i18n/locale';
import { messages } from '../i18n/messages';
import { GliderLine } from './GliderLine';

const { locale } = useLocaleStore.getInitialState();
const text = messages[locale];
const RUSH = { id: '44444444-2222-4333-8444-555555555555', manufacturer: 'Ozone', model: 'Rush 6', size: 'ML', certification: 'EN-B', isDefault: true } as const;
const noop = () => Promise.resolve();

describe('GliderLine', () => {
  it('чужой полёт: только подпись крыла', () => {
    const html = renderToString(
      <GliderLine glider={{ id: RUSH.id, label: 'Ozone Rush 6 ML' }} gliderRaw={null} gliders={undefined} onSelect={noop} />,
    );
    expect(html).toContain('Ozone Rush 6 ML');
    expect(html).not.toContain('<select');
  });

  it('чужой полёт без крыла и без записи прибора — ничего', () => {
    expect(renderToString(<GliderLine glider={null} gliderRaw={null} gliders={undefined} onSelect={noop} />)).toBe('');
  });

  it('свой полёт, крыльев нет: ссылка на «Мои крылья» и что записал прибор', () => {
    const html = renderToString(<GliderLine glider={null} gliderRaw="OZONE Rush6" gliders={[]} onSelect={noop} />);
    expect(html).toContain('href="#/settings"');
    expect(html).toContain('OZONE Rush6');
  });

  it('свой полёт: выбор из своих крыльев, текущее выбрано', () => {
    const html = renderToString(
      <GliderLine glider={{ id: RUSH.id, label: 'Ozone Rush 6 ML' }} gliderRaw={null} gliders={[RUSH]} onSelect={noop} />,
    );
    expect(html).toContain('<select');
    expect(html).toContain(`value="${RUSH.id}" selected=""`);
    expect(html).toContain(text['glider.none']);
  });
});
