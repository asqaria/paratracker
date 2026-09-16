import { createReadStream } from 'node:fs';
import { cp, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';

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

/**
 * Типы отдаём сами: воркеры Cesium браузер не выполнит с text/html,
 * а именно так выглядел ответ, когда запрос доезжал до SPA-фолбэка.
 */
const ASSET_MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/** Путь к Build/Cesium установленного пакета. */
export function resolveCesiumBuildDir(fromUrl: string): string {
  const require = createRequire(fromUrl);
  // Резолвим сам package.json: точка входа пакета — ESM в Source/.
  return join(dirname(require.resolve('cesium/package.json')), 'Build', 'Cesium');
}

/**
 * Файл ассета по URL запроса (префикс /cesium/ уже снят) либо null, если это
 * не ассет Cesium или попытка выйти за пределы Build/Cesium.
 */
export function resolveCesiumAssetPath(url: string, buildDir: string): string | null {
  const path = decodeURIComponent((url.split('?')[0] ?? '').split('#')[0] ?? '').replace(/^\/+/, '');
  if (!CESIUM_ASSET_DIRS.some((name) => path === name || path.startsWith(`${name}/`))) return null;

  const root = resolve(buildDir);
  const target = resolve(root, normalize(path));
  const within = relative(root, target);
  // '..' в начале — выход наружу, пустая строка — сам каталог, не файл.
  if (within === '' || within.startsWith('..')) return null;
  return target;
}

export const cesiumAssetMime = (file: string): string =>
  ASSET_MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';

export function cesiumAssets(): Plugin {
  const buildDir = resolveCesiumBuildDir(import.meta.url);

  return {
    name: 'skyline:cesium-assets',

    config: () => ({
      define: { CESIUM_BASE_URL: JSON.stringify(CESIUM_BASE_PATH) },
    }),

    configureServer: (server) => {
      // Файл отдаётся здесь же: возвращать запрос в общий стек нельзя —
      // статики с корнем Build/Cesium в нём нет, и ответом будет index.html.
      server.middlewares.use(CESIUM_BASE_PATH, (request, response, next) => {
        const file = resolveCesiumAssetPath(request.url ?? '/', buildDir);
        if (file === null) {
          next();
          return;
        }
        void stat(file).then(
          (info) => {
            if (!info.isFile()) {
              next();
              return;
            }
            response.setHeader('content-type', cesiumAssetMime(file));
            response.setHeader('content-length', String(info.size));
            createReadStream(file).pipe(response);
          },
          () => next(),
        );
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
