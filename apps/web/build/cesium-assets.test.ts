import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CESIUM_ASSET_DIRS,
  CESIUM_BASE_PATH,
  cesiumAssetMime,
  resolveCesiumAssetPath,
  resolveCesiumBuildDir,
} from './cesium-assets';

describe('статические ассеты Cesium', () => {
  it('каталог Build/Cesium находится в установленном пакете', () => {
    const buildDir = resolveCesiumBuildDir(import.meta.url);
    expect(existsSync(buildDir), buildDir).toBe(true);
  });

  it('все нужные каталоги есть на месте', () => {
    const buildDir = resolveCesiumBuildDir(import.meta.url);
    for (const dir of CESIUM_ASSET_DIRS) {
      expect(existsSync(join(buildDir, dir)), dir).toBe(true);
    }
  });

  it('базовый путь заканчивается слешем — Cesium дописывает к нему имена файлов', () => {
    expect(CESIUM_BASE_PATH.endsWith('/')).toBe(true);
  });
});

describe('resolveCesiumAssetPath', () => {
  const buildDir = resolveCesiumBuildDir(import.meta.url);

  it('ведёт на существующий файл ассета', () => {
    // Регрессия: раньше dev-сервер возвращал на этот URL index.html,
    // потому что запрос уходил обратно в общий стек middleware.
    const file = resolveCesiumAssetPath('/Assets/approximateTerrainHeights.json', buildDir);
    expect(file).not.toBeNull();
    expect(existsSync(String(file)), String(file)).toBe(true);
  });

  it('игнорирует запросы вне каталогов Cesium — их обслужит Vite', () => {
    expect(resolveCesiumAssetPath('/index.html', buildDir)).toBeNull();
    expect(resolveCesiumAssetPath('/', buildDir)).toBeNull();
    expect(resolveCesiumAssetPath('/AssetsOther/file.js', buildDir)).toBeNull();
  });

  it('не отдаёт файлы за пределами Build/Cesium', () => {
    expect(resolveCesiumAssetPath('/Assets/../../../package.json', buildDir)).toBeNull();
    expect(resolveCesiumAssetPath('/Assets/%2e%2e/%2e%2e/package.json', buildDir)).toBeNull();
  });

  it('отбрасывает строку запроса и фрагмент', () => {
    const plain = resolveCesiumAssetPath('/Widgets/widgets.css', buildDir);
    expect(resolveCesiumAssetPath('/Widgets/widgets.css?v=1', buildDir)).toBe(plain);
    expect(resolveCesiumAssetPath('/Widgets/widgets.css#top', buildDir)).toBe(plain);
  });
});

describe('cesiumAssetMime', () => {
  it('воркеры и JSON получают исполняемые типы, а не text/html', () => {
    expect(cesiumAssetMime('Workers/transferTypedArrayTest.js')).toBe('text/javascript');
    expect(cesiumAssetMime('Assets/approximateTerrainHeights.json')).toBe('application/json');
    expect(cesiumAssetMime('Widgets/widgets.css')).toBe('text/css');
  });

  it('незнакомое расширение отдаётся как поток байтов', () => {
    expect(cesiumAssetMime('Assets/IAU2006_XYS/IAU2006_XYS_0.bin')).toBe('application/octet-stream');
  });
});
