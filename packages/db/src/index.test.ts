import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('@skyline/db', () => {
  it('импортируется', () => {
    expect(PACKAGE_NAME).toBe('@skyline/db');
  });
});
