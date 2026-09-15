import { describe, expect, it } from 'vitest';

import { ProblemDetails } from './problem.js';

describe('ProblemDetails', () => {
  it('сохраняет члены-расширения (RFC 9457 §3.2)', () => {
    const body = { type: 'about:blank', title: 'Bad Request', status: 400, errors: [{ path: 'x' }] };
    expect(ProblemDetails.parse(body)).toEqual(body);
  });

  it('status — только коды ошибок 4xx/5xx', () => {
    expect(ProblemDetails.safeParse({ type: 'about:blank', title: 'OK', status: 200 }).success).toBe(false);
  });
});
