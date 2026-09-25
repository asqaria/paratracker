import { describe, expect, it, vi } from 'vitest';

import { fetchImageryCapabilities, IMAGERY_CAPABILITIES_URL } from './imagery-capabilities';

const respond = (status: number, body: unknown): typeof fetch =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('fetchImageryCapabilities', () => {
  it('спрашивает /api/v1/imagery и отдаёт разобранный ответ', async () => {
    const fetchImpl = respond(200, { esri: true });
    await expect(fetchImageryCapabilities(new AbortController().signal, fetchImpl)).resolves.toEqual({ esri: true });
    expect(fetchImpl).toHaveBeenCalledWith(IMAGERY_CAPABILITIES_URL, expect.anything());
  });

  it('API ответил ошибкой — исключение: Esri не показываем', async () => {
    await expect(fetchImageryCapabilities(new AbortController().signal, respond(503, {}))).rejects.toThrow(/503/);
  });

  it('ответ не по контракту — исключение, а не догадка', async () => {
    await expect(fetchImageryCapabilities(new AbortController().signal, respond(200, { esri: 'yes' }))).rejects.toThrow();
  });
});
