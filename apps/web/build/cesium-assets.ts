import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, posix } from 'node:path';

import type { Plugin } from 'vite';

/**
 * Cesium возит с собой статические ассеты (воркеры, шейдеры, иконки виджетов) —
 * их нельзя собрать бандлером, они грузятся по CESIUM_BASE_URL в рантайме.
 * В dev отдаём их из node_modules, при сборке копируем в dist.
 *
 * Своя реализация вместо vite-plugin-cesium: тот не поддерживается и тянет
 * лишние зависимости, а нужного тут — тридцать строк.
 */

/** Базовый путь, по которому Cesium ищет свои ассеты. */
export const CESIUM_BASE_PATH = '/cesium/';

/** Каталоги из Build/Cesium, без которых сцена не поднимется. */
export const CESIUM_ASSET_DIRS = ['Assets', 'ThirdParty', 'Widgets', 'Workers'] as const;

/** Путь к Build/Cesium установленного пакета. */
export function resolveCesiumBuildDir(fromUrl: string): string {
  const require = createRequire(fromUrl);
  // Резолвим сам package.json: точка входа пакета — ESM в Source/.
  return join(dirname(require.resolve('cesium/package.json')), 'Build', 'Cesium');
}

export function cesiumAssets(): Plugin {
  const buildDir = resolveCesiumBuildDir(import.meta.url);

  return {
    name: 'skyline:cesium-assets',

    config: () => ({
      define: { CESIUM_BASE_URL: JSON.stringify(CESIUM_BASE_PATH) },
    }),

    configureServer: (server) => {
      server.middlewares.use(CESIUM_BASE_PATH, (request, response, next) => {
        const url = request.url ?? '/';
        const dir = CESIUM_ASSET_DIRS.find((name) => url.startsWith(`/${name}/`));
        if (!dir) {
          next();
          return;
        }
        // sirv настроен на корень Build/Cesium: путь из запроса уже относительный.
        server.middlewares.handle(Object.assign(request, { url: posix.join('/', url) }), response, next);
      });
    },

    // Копируем ассеты в dist/cesium: в проде их раздаёт статика, не бандл.
    writeBundle: async (options) => {
      const outDir = options.dir ?? 'dist';
      for (const dir of CESIUM_ASSET_DIRS) {
        const target = join(outDir, 'cesium', dir);
        await mkdir(dirname(target), { recursive: true });
        await cp(join(buildDir, dir), target, { recursive: true });
      }
    },
  };
}
