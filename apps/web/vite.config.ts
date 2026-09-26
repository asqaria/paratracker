import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

import { cesiumAssets } from './build/cesium-assets.ts';
import { initialLoadBudget } from './build/initial-load-budget.ts';

/**
 * ТЗ §7.7: начальный чанк ≤ 250 КБ gzip, без Cesium и MapLibre.
 * КБ = 1000 байт — строже из двух прочтений.
 */
const INITIAL_LOAD_BUDGET_GZIP_BYTES = 250_000;

const REPO_ROOT = '../..';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, REPO_ROOT, '');
  const apiPort = env.API_PORT ?? '3000';

  return {
    plugins: [
      react(),
      tailwindcss(),
      cesiumAssets(),
      initialLoadBudget({ maxGzipBytes: INITIAL_LOAD_BUDGET_GZIP_BYTES }),
    ],
    // Конфиг сцены приходит только из окружения: хардкод адресов тайлов запрещён.
    // .env лежит в корне монорепозитория — Vite по умолчанию искал бы его в apps/web.
    envDir: REPO_ROOT,
    envPrefix: ['VITE_'],
    server: {
      // В dev фронт и API на одном origin: без CORS, как за обратным прокси в проде.
      // /s/ — ссылка «поделиться»: страницу с превью для мессенджеров отдаёт API (задача 3.8).
      proxy: { '/api': `http://127.0.0.1:${apiPort}`, '/s/': `http://127.0.0.1:${apiPort}` },
    },
  };
});
