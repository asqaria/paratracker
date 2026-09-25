import { ImageryCapabilities } from '@skyline/core';

export const IMAGERY_CAPABILITIES_URL = '/api/v1/imagery';

/**
 * Какие подложки через сервер настроены (GET /api/v1/imagery). Ошибка или
 * ответ не по контракту — исключение: сцена тогда просто не показывает Esri.
 */
export async function fetchImageryCapabilities(
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ImageryCapabilities> {
  const response = await fetchImpl(IMAGERY_CAPABILITIES_URL, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Imagery capabilities failed: HTTP ${response.status}`);
  return ImageryCapabilities.parse(await response.json());
}
