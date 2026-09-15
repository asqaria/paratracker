import { gzipSync } from 'node:zlib';

import type { Plugin } from 'vite';

/** Минимум полей бандла, нужный для расчёта; совместим с OutputChunk/OutputAsset. */
export interface BudgetChunk {
  type: 'chunk';
  fileName: string;
  code: string;
  isEntry: boolean;
  imports: readonly string[];
  moduleIds: readonly string[];
  viteMetadata?: { importedCss: ReadonlySet<string> };
}
export interface BudgetAsset {
  type: 'asset';
  fileName: string;
  source: string | Uint8Array;
}
export type BudgetBundle = Record<string, BudgetChunk | BudgetAsset>;

export interface InitialLoadReport {
  files: { fileName: string; gzipBytes: number }[];
  totalGzipBytes: number;
  /** Модули Cesium/MapLibre, попавшие в начальную загрузку. */
  forbiddenModules: string[];
}

/** ТЗ §7.7: Cesium и MapLibre — только ленивыми чанками. */
const FORBIDDEN_MODULE = /[\\/]node_modules[\\/](?:cesium|@cesium[\\/][^\\/]+|maplibre-gl)[\\/]/;

/**
 * Начальная загрузка = входные чанки + всё, что они импортируют статически,
 * + их CSS. Динамические импорты (React.lazy) не считаются.
 */
export function measureInitialLoad(bundle: BudgetBundle): InitialLoadReport {
  const pending = Object.values(bundle).filter((item) => item.type === 'chunk' && item.isEntry);
  const visited = new Set<string>();
  const files: InitialLoadReport['files'] = [];
  const forbiddenModules: string[] = [];

  const add = (fileName: string, content: string | Uint8Array): void => {
    if (visited.has(fileName)) return;
    visited.add(fileName);
    files.push({ fileName, gzipBytes: gzipSync(content).byteLength });
  };

  for (let item = pending.pop(); item; item = pending.pop()) {
    if (item.type !== 'chunk' || visited.has(item.fileName)) continue;
    add(item.fileName, item.code);
    forbiddenModules.push(...item.moduleIds.filter((id) => FORBIDDEN_MODULE.test(id)));

    for (const css of item.viteMetadata?.importedCss ?? []) {
      const asset = bundle[css];
      if (asset?.type === 'asset') add(asset.fileName, asset.source);
    }
    for (const imported of item.imports) {
      const next = bundle[imported];
      if (next) pending.push(next);
    }
  }

  files.sort((a, b) => b.gzipBytes - a.gzipBytes);
  const totalGzipBytes = files.reduce((sum, f) => sum + f.gzipBytes, 0);
  return { files, totalGzipBytes, forbiddenModules };
}

const BYTES_PER_KB = 1000;
const kb = (bytes: number): string => `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;

/** Валит `vite build`, если начальная загрузка превышает бюджет или тянет карты. */
export function initialLoadBudget(options: { maxGzipBytes: number }): Plugin {
  return {
    name: 'skyline:initial-load-budget',
    apply: 'build',
    generateBundle(_output, bundle) {
      const report = measureInitialLoad(bundle);
      const lines = report.files.map((f) => `  ${kb(f.gzipBytes).padStart(10)}  ${f.fileName}`);
      const summary = `initial load: ${kb(report.totalGzipBytes)} gzip of ${kb(options.maxGzipBytes)} budget\n${lines.join('\n')}`;

      if (report.forbiddenModules.length > 0) {
        this.error(
          `Cesium/MapLibre in the initial load — load them via React.lazy (SPEC §7.7):\n  ${report.forbiddenModules.join('\n  ')}`,
        );
      }
      if (report.totalGzipBytes > options.maxGzipBytes) {
        this.error(`Initial load budget exceeded (SPEC §7.7)\n${summary}`);
      }
      this.info(summary);
    },
  };
}
