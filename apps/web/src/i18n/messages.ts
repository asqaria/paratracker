import type { Locale } from '@skyline/core';

const ru = {
  'app.name': 'Skyline',
  'health.title': 'Состояние системы',
  'health.loading': 'Проверяем…',
  'health.unreachable': 'API недоступен',
  'health.ok': 'Всё работает',
  'health.degraded': 'Есть недоступные сервисы',
  'health.database': 'База данных',
  'health.storage': 'Объектное хранилище',
  'health.postgis': 'PostGIS',
  'health.up': 'доступно',
  'health.down': 'недоступно',
  'locale.label': 'Язык',
  'locale.ru': 'RU',
  'locale.en': 'EN',
  'viewer.loading': 'Загружаем трек…',
  'viewer.loadingScene': 'Готовим 3D-сцену…',
  'viewer.error': 'Трек не загрузился',
  'viewer.imagery': 'Подложка',
  'viewer.imagery.sentinel2': 'Sentinel-2',
  'viewer.imagery.esri': 'Esri',
  'viewer.points': 'Точек',
} as const;

export type MessageKey = keyof typeof ru;
type Messages = Record<MessageKey, string>;

const en: Messages = {
  'app.name': 'Skyline',
  'health.title': 'System status',
  'health.loading': 'Checking…',
  'health.unreachable': 'API is unreachable',
  'health.ok': 'All systems operational',
  'health.degraded': 'Some services are unavailable',
  'health.database': 'Database',
  'health.storage': 'Object storage',
  'health.postgis': 'PostGIS',
  'health.up': 'up',
  'health.down': 'down',
  'locale.label': 'Language',
  'locale.ru': 'RU',
  'locale.en': 'EN',
  'viewer.loading': 'Loading track…',
  'viewer.loadingScene': 'Preparing the 3D scene…',
  'viewer.error': 'Track failed to load',
  'viewer.imagery': 'Imagery',
  'viewer.imagery.sentinel2': 'Sentinel-2',
  'viewer.imagery.esri': 'Esri',
  'viewer.points': 'Points',
};

export const messages: Record<Locale, Messages> = { ru, en };
