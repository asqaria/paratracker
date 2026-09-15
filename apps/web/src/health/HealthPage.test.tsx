import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useLocaleStore } from '../i18n/locale';
import { messages } from '../i18n/messages';
import { HealthPage } from './HealthPage';

describe('HealthPage', () => {
  it('до ответа API показывает локализованное «проверяем»', () => {
    // На сервере Zustand рендерит начальное состояние стора, поэтому сверяемся с ним.
    const { locale } = useLocaleStore.getInitialState();

    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <HealthPage />
      </QueryClientProvider>,
    );

    expect(html).toContain(messages[locale]['health.loading']);
    expect(html).toContain(`lang="${locale}"`);
  });
});
