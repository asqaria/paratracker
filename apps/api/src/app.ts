import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { API_V1_PREFIX } from './constants.js';
import { registerHealthRoutes, type HealthRouteOptions } from './health.js';
import { registerProblemHandlers } from './problem.js';

export interface AppOptions {
  /** Fastify пишет структурные JSON-логи через pino. */
  logger: Exclude<FastifyServerOptions['logger'], undefined>;
  health: HealthRouteOptions;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger });

  registerProblemHandlers(app);
  void app.register(
    (v1, _opts, done) => {
      registerHealthRoutes(v1, options.health);
      done();
    },
    { prefix: API_V1_PREFIX },
  );

  return app;
}
