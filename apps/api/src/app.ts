import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { registerAnalysisRoutes, type AnalysisRoutesDeps } from './analysis.js';
import { registerAuthHook, registerAuthRoutes, type AuthDeps } from './auth/routes.js';
import { API_V1_PREFIX } from './constants.js';
import { registerFlightSettingsRoutes, type FlightSettingsDeps } from './flight-settings.js';
import { registerFlightRoutes, type FlightRoutesDeps } from './flights.js';
import { registerGliderRoutes, type GliderRoutesDeps } from './gliders.js';
import { registerHealthRoutes, type HealthRouteOptions } from './health.js';
import { registerLogbookRoutes, type LogbookRoutesDeps } from './logbook.js';
import { registerProblemHandlers } from './problem.js';
import { registerReviewRoutes, type ReviewRoutesDeps } from './reviews.js';
import { registerSharePageRoute, registerSharePreviewRoute, type SharePageDeps } from './share-page.js';
import { registerSiteRoutes, type SiteRoutesDeps } from './sites.js';
import { registerTileRoutes, type TileRoutesDeps } from './tiles.js';

export interface AppOptions {
  /** Fastify пишет структурные JSON-логи через pino. */
  logger: Exclude<FastifyServerOptions['logger'], undefined>;
  health?: HealthRouteOptions;
  /** Маршруты полётов; без них поднимается только health. */
  flights?: FlightRoutesDeps;
  /** Аналитика полёта: детали, термики, глайды, ветер. */
  analysis?: AnalysisRoutesDeps;
  /** Прокси тайлов подложки; ключ провайдера остаётся на сервере. */
  tiles?: TileRoutesDeps;
  /** Вход и сессии; без них все запросы анонимные. */
  auth?: AuthDeps;
  /** Логбук; без входа (auth) не регистрируется — у анонима логбука нет. */
  logbook?: LogbookRoutesDeps;
  /** Места старта; как и логбук — только со входом. */
  sites?: SiteRoutesDeps;
  /** Крылья пилота и крыло полёта (задача 2.13б); только со входом. */
  gliders?: GliderRoutesDeps;
  /** Сверка термиков владельцем (DoD фазы 2); только со входом. */
  reviews?: ReviewRoutesDeps;
  /** Настройки своего полёта (крыло, приватность, ссылка) и открытие ссылки (задача 3.7). */
  flightSettings?: FlightSettingsDeps;
  /** Ссылка для мессенджеров: страница /s/:token с превью (задача 3.8). */
  sharePage?: SharePageDeps;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger });

  registerProblemHandlers(app);
  registerAuthHook(app, options.auth);
  if (options.sharePage) registerSharePageRoute(app, options.sharePage);
  void app.register(
    (v1, _opts, done) => {
      if (options.health) registerHealthRoutes(v1, options.health);
      if (options.auth) registerAuthRoutes(v1, options.auth);
      if (options.auth && options.logbook) registerLogbookRoutes(v1, options.logbook);
      if (options.auth && options.sites) registerSiteRoutes(v1, options.sites);
      if (options.auth && options.gliders) registerGliderRoutes(v1, options.gliders);
      if (options.auth && options.reviews) registerReviewRoutes(v1, options.reviews);
      if (options.auth && options.flightSettings) registerFlightSettingsRoutes(v1, options.flightSettings);
      if (options.flights) registerFlightRoutes(v1, options.flights);
      if (options.analysis) registerAnalysisRoutes(v1, options.analysis);
      if (options.tiles) registerTileRoutes(v1, options.tiles);
      if (options.sharePage) registerSharePreviewRoute(v1, options.sharePage);
      done();
    },
    { prefix: API_V1_PREFIX },
  );

  return app;
}
