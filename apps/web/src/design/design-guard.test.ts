import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Дизайн-система (ТЗ §8.4, задача 1.15): цвета — только токены @theme,
 * цифры — только утилитой numeric (шрифт + tabular-nums вместе).
 * Палитра вариометра живёт в vario-palette.ts: это данные трека, не UI.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
/**
 * Палитры трека — данные, не UI: вариометр и цвета пилотов в сравнении (задача 3.12).
 * tokens.ts — единственное место, где собирается rgb() из токена.
 */
const ALLOWED_COLORS = new Set(['viewer/vario-palette.ts', 'viewer/compare-palette.ts', 'design/tokens.ts']);
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:])\/\/.*$/gm;
const NOT_NEWLINE = /[^\n]/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function code(file: string): string[] {
  return readFileSync(join(SRC, file), 'utf8')
    .replace(BLOCK_COMMENT, (comment) => comment.replace(NOT_NEWLINE, ''))
    .replace(LINE_COMMENT, '$1')
    .split('\n');
}

const files = sourceFiles(SRC).map((path) => relative(SRC, path).split(sep).join('/'));

const offenders = (test: (line: string, file: string) => boolean): string[] =>
  files.flatMap((file) =>
    code(file).flatMap((line, index) => (test(line, file) ? [`${file}:${index + 1}: ${line.trim()}`] : [])),
  );

describe('дизайн-система', () => {
  it('цвета в коде — только из токенов (кроме палитры вариометра)', () => {
    expect(offenders((line, file) => !ALLOWED_COLORS.has(file) && RAW_COLOR.test(line))).toEqual([]);
  });

  it('font-numeric не ставится вручную — только утилита numeric с tabular-nums', () => {
    expect(offenders((line) => /\bfont-numeric\b|\btabular-nums\b/.test(line))).toEqual([]);
  });
});
