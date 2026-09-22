import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useLocaleStore } from '../i18n/locale';
import { messages } from '../i18n/messages';
import { ACCEPT_ATTRIBUTE } from './upload-track';
import { UploadPage } from './UploadPage';

/** Серверный рендер: состояние покоя проверяется без DOM и drag-n-drop. */

describe('UploadPage', () => {
  // На сервере Zustand отдаёт начальное состояние стора, сверяемся с ним.
  const { locale } = useLocaleStore.getInitialState();
  const html = renderToString(<UploadPage />);

  it('зовёт бросить трек и называет форматы с порогом размера', () => {
    expect(html).toContain(messages[locale]['upload.title']);
    expect(html).toContain('50');
    expect(html).toContain(`lang="${locale}"`);
  });

  it('input принимает только форматы треков', () => {
    expect(html).toContain(`accept="${ACCEPT_ATTRIBUTE}"`);
    expect(html).toContain('type="file"');
  });

  it('в покое нет ни прогресса, ни ошибки', () => {
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('role="alert"');
  });

  it('даёт уйти в демо и к состоянию сервисов', () => {
    expect(html).toContain('href="#/demo"');
    expect(html).toContain('href="#/health"');
  });
});
