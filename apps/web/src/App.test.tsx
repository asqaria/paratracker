import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('@skyline/web', () => {
  it('импортируется и рендерится', () => {
    expect(renderToString(<App />)).toBe('');
  });
});
