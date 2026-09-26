import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { registerAnalysisRoutes, type AnalysisRoutesDeps } from './analysis.js';
import { registerAuthHook, registerAuthRoutes, type AuthDeps } from './auth/routes.js';
import { API_V1_PREFIX } from './constants.js';
import { registerFlightRoutes, type FlightRoutesDeps } from './flights.js';
import { registerHealthRoutes, type HealthRouteOptions } from './health.js';
import { registerLogbookRoutes, type LogbookRoutesDeps } from './logbook.js';
import { registerProblemHandlers } from './problem.js';
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
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger });

  registerProblemHandlers(app);
  registerAuthHook(app, options.auth);
  void app.register(
    (v1, _opts, done) => {
      if (options.health) registerHealthRoutes(v1, options.health);
      if (options.auth) registerAuthRoutes(v1, options.auth);
      if (options.auth && options.logbook) registerLogbookRoutes(v1, options.logbook);
      if (options.flights) registerFlightRoutes(v1, options.flights);
      if (options.analysis) registerAnalysisRoutes(v1, options.analysis);
      if (options.tiles) registerTileRoutes(v1, options.tiles);
      done();
    },
    { prefix: API_V1_PREFIX },
  );

  return app;
}
