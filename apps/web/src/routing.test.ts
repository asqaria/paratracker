import { describe, expect, it } from 'vitest';

import { trackUrlFromHash } from './routing';

describe('trackUrlFromHash', () => {
  it('полёт по id — .track из API', () => {
    expect(trackUrlFromHash('#/flight/11111111-2222-4333-8444-555555555555')).toBe(
      '/api/v1/flights/11111111-2222-4333-8444-555555555555/track',
    );
  });

  it('демо-трек', () => {
    expect(trackUrlFromHash('#/demo')).toBe('/demo/baseline.track');
  });

  it.each(['', '#/', '#/flight/', '#/flight/not-a-uuid', '#/other'])('лендинг для %j', (hash) => {
    expect(trackUrlFromHash(hash)).toBeNull();
  });
});
