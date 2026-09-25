import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useLocaleStore } from '../i18n/locale';
import { messages } from '../i18n/messages';
import { legendGradient, legendTicks } from './vario-legend';
import { VarioLegend } from './VarioLegend';

/** Серверный рендер берёт начальную локаль стора — сверяемся с ней. */

describe('VarioLegend', () => {
  const { locale } = useLocaleStore.getInitialState();
  const html = renderToString(<VarioLegend />);

  it('подпись шкалы и описание для скринридера — из i18n', () => {
    expect(html).toContain(messages[locale]['viewer.varioLegend']);
    expect(html).toContain('role="img"');
    expect(html).toContain(`aria-label="${messages[locale]['viewer.varioLegend.description']}"`);
  });

  it('полоса — градиент из палитры трека', () => {
    // Начало строки градиента: style сериализуется как есть, без переформатирования.
    expect(html).toContain(legendGradient().slice(0, 40));
  });

  it('все подписи шкалы, моноширинные табличные', () => {
    for (const tick of legendTicks(locale)) expect(html).toContain(`>${tick.label}<`);
    expect(html).toContain('tabular-nums');
  });
});
