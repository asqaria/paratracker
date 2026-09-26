import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { useLocaleStore } from '../i18n/locale';
import { messages } from '../i18n/messages';
import { SHEET } from './bottom-sheet';
import { BottomSheet } from './BottomSheet';

/** Шторка — серверным рендером: ручка с состоянием, сводка всегда, высота положения. */

const { locale } = useLocaleStore.getInitialState();
const text = messages[locale];

describe('BottomSheet', () => {
  it('свёрнута: ручка «раскрыть», сводка видна, высота свёрнутой', () => {
    const html = renderToString(
      <BottomSheet summary={<p>СВОДКА</p>}>
        <p>СОДЕРЖИМОЕ</p>
      </BottomSheet>,
    );
    expect(html).toContain('data-snap="peek"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`aria-label="${text['viewer.sheet.expand']}"`);
    expect(html).toContain('СВОДКА');
    expect(html).toContain(`height:${SHEET.peekPx}px`);
    // Содержимое свёрнутой шторки скрыто — и от глаз, и от экранного диктора.
    expect(html).toMatch(/aria-hidden="true"[^>]*invisible/);
  });

  it('раскрытая: ручка «свернуть»', () => {
    const html = renderToString(
      <BottomSheet summary={<p>СВОДКА</p>} defaultSnap="half">
        <p>СОДЕРЖИМОЕ</p>
      </BottomSheet>,
    );
    expect(html).toContain('data-snap="half"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(`aria-label="${text['viewer.sheet.collapse']}"`);
    expect(html).toContain('СОДЕРЖИМОЕ');
  });
});
