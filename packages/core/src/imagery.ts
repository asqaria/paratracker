import { z } from 'zod';

/**
 * Ответ GET /api/v1/imagery: какие подложки через сервер реально настроены
 * (ТЗ §4.4.1). Sentinel-2 фронт берёт напрямую у EOX — его здесь нет.
 * Без этого фронт показывал кнопку Esri по одному адресу прокси, и при
 * ненастроенном ключе пилот получал синий шар без объяснения.
 */
export const ImageryCapabilities = z.object({
  /** Прокси Esri настроен: есть и ключ ArcGIS, и шаблон адреса тайлов. */
  esri: z.boolean(),
});
export type ImageryCapabilities = z.infer<typeof ImageryCapabilities>;
