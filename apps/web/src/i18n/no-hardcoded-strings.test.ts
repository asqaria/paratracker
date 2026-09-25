import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md: строки UI — только через i18n. Правило про JSX не видит текст
 * внутри шаблонных строк и в данных (подписи атрибуции) — этот
 * тест ловит такой текст по кириллице в коде вне переводов. Английские
 * вшитые строки он не поймает: защита частичная.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
const ALLOWED = new Set(['i18n/messages.ts']);
const CYRILLIC = /[А-Яа-яЁё]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Блочные комментарии (и JSX-комментарии в фигурных скобках) и строчные после «//». */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** «//» не после двоеточия: иначе https:// в строке сочтётся комментарием. */
const LINE_COMMENT = /(^|[^:])\/\/.*$/gm;
const NOT_NEWLINE = /[^\n]/g;

function stripComments(code: string): string {
  // Переводы строк внутри блока сохраняются — иначе номера строк в отчёте уедут.
  return code
    .replace(BLOCK_COMMENT, (comment) => comment.replace(NOT_NEWLINE, ''))
    .replace(LINE_COMMENT, '$1');
}

describe('строки UI только через i18n', () => {
  it('кириллица в коде apps/web/src — только в i18n/messages.ts', () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(SRC, path).split(sep).join('/'))
      .filter((file) => !ALLOWED.has(file))
      .flatMap((file) =>
        stripComments(readFileSync(join(SRC, file), 'utf8'))
          .split('\n')
          .flatMap((line, index) => (CYRILLIC.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [])),
      );

    expect(offenders).toEqual([]);
  });
});
