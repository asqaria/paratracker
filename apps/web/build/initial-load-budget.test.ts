import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { measureInitialLoad, type BudgetBundle, type BudgetChunk } from './initial-load-budget';

const chunk = (fileName: string, overrides: Partial<BudgetChunk> = {}): BudgetChunk => ({
  type: 'chunk',
  fileName,
  code: `/* ${fileName} */ export default 1;`.repeat(20),
  isEntry: false,
  imports: [],
  moduleIds: [],
  ...overrides,
});

const gz = (s: string): number => gzipSync(s).byteLength;

describe('measureInitialLoad', () => {
  it('считает вход, его статические импорты и CSS, но не ленивые чанки', () => {
    const entry = chunk('index.js', {
      isEntry: true,
      imports: ['vendor.js'],
      viteMetadata: { importedCss: new Set(['index.css']) },
    });
    const vendor = chunk('vendor.js');
    const lazy = chunk('viewer.js', { moduleIds: ['/repo/node_modules/cesium/index.js'] });
    const css = 'body{color:red}'.repeat(10);
    const bundle: BudgetBundle = {
      'index.js': entry,
      'vendor.js': vendor,
      'viewer.js': lazy,
      'index.css': { type: 'asset', fileName: 'index.css', source: css },
    };

    const report = measureInitialLoad(bundle);

    expect(report.files.map((f) => f.fileName).sort()).toEqual(['index.css', 'index.js', 'vendor.js']);
    expect(report.totalGzipBytes).toBe(gz(entry.code) + gz(vendor.code) + gz(css));
    expect(report.forbiddenModules).toEqual([]);
  });

  it('находит Cesium и MapLibre в начальной загрузке, в т.ч. по путям pnpm', () => {
    const bundle: BudgetBundle = {
      'index.js': chunk('index.js', {
        isEntry: true,
        moduleIds: [
          '/repo/node_modules/.pnpm/cesium@1.130.0/node_modules/@cesium/engine/Source/Scene.js',
          'C:\\repo\\node_modules\\maplibre-gl\\dist\\maplibre-gl.js',
          '/repo/apps/web/src/viewer/cesium-adapter.ts',
        ],
      }),
    };

    expect(measureInitialLoad(bundle).forbiddenModules).toHaveLength(2);
  });

  it('общий импорт двух входов считается один раз', () => {
    const shared = chunk('shared.js');
    const bundle: BudgetBundle = {
      'a.js': chunk('a.js', { isEntry: true, imports: ['shared.js'] }),
      'b.js': chunk('b.js', { isEntry: true, imports: ['shared.js'] }),
      'shared.js': shared,
    };

    expect(measureInitialLoad(bundle).files.filter((f) => f.fileName === 'shared.js')).toHaveLength(1);
  });
});
