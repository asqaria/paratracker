import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useLocaleStore } from '../i18n/locale';
import { messages } from '../i18n/messages';
import { retentionMessage } from './messages';
import { ACCEPT_ATTRIBUTE } from './upload-track';
import { UploadPage } from './UploadPage';

/** Серверный рендер: состояние покоя проверяется без DOM и drag-n-drop. */

const withQuery = (node: ReactNode): string =>
  renderToString(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);

describe('UploadPage', () => {
  // На сервере Zustand отдаёт начальное состояние стора, сверяемся с ним.
  const { locale } = useLocaleStore.getInitialState();
  const html = withQuery(<UploadPage />);

  it('зовёт бросить трек и называет форматы с порогом размера', () => {
    expect(html).toContain(messages[locale]['upload.title']);
    expect(html).toContain('50');
    expect(html).toContain(`lang="${locale}"`);
  });

  it('предупреждает о сроке хранения анонимной загрузки (ТЗ §11.2)', () => {
    expect(html).toContain(retentionMessage((key) => messages[locale][key], locale));
  });

  it('input принимает только форматы треков', () => {
    expect(html).toContain(`accept="${ACCEPT_ATTRIBUTE}"`);
    expect(html).toContain('type="file"');
  });

  it('в покое нет ни прогресса, ни ошибки', () => {
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('role="alert"');
  });

  it('после неудачного входа говорит об этом', () => {
    expect(html).not.toContain(messages[locale]['auth.failed']);
    expect(withQuery(<UploadPage authFailed />)).toContain(messages[locale]['auth.failed']);
  });

  it('даёт уйти в демо и к состоянию сервисов', () => {
    expect(html).toContain('href="#/demo"');
    expect(html).toContain('href="#/health"');
  });
});
