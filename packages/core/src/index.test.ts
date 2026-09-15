import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('@skyline/core', () => {
  it('импортируется', () => {
    expect(PACKAGE_NAME).toBe('@skyline/core');
  });
});
