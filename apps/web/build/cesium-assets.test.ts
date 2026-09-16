import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CESIUM_ASSET_DIRS, CESIUM_BASE_PATH, resolveCesiumBuildDir } from './cesium-assets';

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
