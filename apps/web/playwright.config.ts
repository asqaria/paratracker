import { defineConfig } from '@playwright/test';

/**
 * E2E фронта (CLAUDE.md: Playwright для e2e). Браузер — системный Chrome:
 * он есть и на машине разработчика, и на раннерах GitHub, скачивать не нужно.
 * Файлы — *.e2e.ts, чтобы Vitest (он берёт *.spec.ts) их не подхватывал.
 */

const PORT = 5174;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',
    // WebGL для Cesium без видеокарты — программный рендер.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // Конфиг сцены обязателен; адреса фиктивные — внешняя сеть в тестах закрыта.
    env: {
      VITE_TERRAIN_URL: 'https://terrain.e2e.invalid/cesium-mesh/ellipsoid',
      VITE_IMAGERY_WMTS_URL: 'https://tiles.e2e.invalid/wmts/{layer}/{TileMatrix}/{TileRow}/{TileCol}.jpg',
      VITE_IMAGERY_WMTS_LAYER: 's2cloudless-2025',
      VITE_ESRI_TILE_URL: '/api/v1/tiles/esri/{z}/{y}/{x}',
    },
  },
});
