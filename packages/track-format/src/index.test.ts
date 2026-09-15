import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('@skyline/track-format', () => {
  it('импортируется', () => {
    expect(PACKAGE_NAME).toBe('@skyline/track-format');
  });
});
