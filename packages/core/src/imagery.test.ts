import { describe, expect, it } from 'vitest';

import { ImageryCapabilities } from './imagery.js';

describe('ImageryCapabilities', () => {
  it('ответ GET /api/v1/imagery: какие подложки настроены на сервере', () => {
    expect(ImageryCapabilities.parse({ esri: true })).toEqual({ esri: true });
    expect(ImageryCapabilities.parse({ esri: false })).toEqual({ esri: false });
  });

  it('без поля или не булево — не принимается: фронт не должен гадать', () => {
    expect(ImageryCapabilities.safeParse({}).success).toBe(false);
    expect(ImageryCapabilities.safeParse({ esri: 'yes' }).success).toBe(false);
  });
});
