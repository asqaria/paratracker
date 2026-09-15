import { defineConfig } from 'eslint/config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

/**
 * Правила зависимостей (CLAUDE.md, ТЗ §4.2, §14).
 *
 * Важно: в flat config опции одного правила из разных блоков НЕ сливаются —
 * побеждает последний подходящий блок. Поэтому каждый блок собирает полный
 * список запретов для своих файлов через `restrict()`.
 *
 * Регулярки без `/`: они же подставляются в селектор esquery для `import()`.
 */

/** @typedef {{ regex: string, message: string }} Ban */

/** @type {Ban} */
const CESIUM = {
  regex: '^@?cesium',
  message: 'Cesium импортируется только внутри apps/web/src/viewer/ (CLAUDE.md, «Фронтенд»).',
};

/** @type {Ban} */
const APPS_FROM_PACKAGES = {
  regex: '^@skyline.(api|worker|web)($|.)',
  message: 'packages/* не зависят от apps/* (CLAUDE.md, «Зависимости между пакетами»).',
};

/** @param {string} allowed */
const coreOnly = (allowed) => ({
  regex: `^(?!(${allowed})($|.)|[.])`,
  message: 'packages/core не зависит ни от чего: ни от пакетов, ни от apps, ни от Node API (ТЗ §4.2).',
});

/** @param {Ban[]} bans */
const restrict = (...bans) => ({
  'no-restricted-imports': [
    'error',
    { patterns: bans.map(({ regex, message }) => ({ regex, message })) },
  ],
  // no-restricted-imports не видит динамический import() — закрываем отдельно.
  'no-restricted-syntax': [
    'error',
    ...bans.map(({ regex, message }) => ({
      selector: `ImportExpression[source.value=/${regex}/]`,
      message,
    })),
  ],
});

export default defineConfig(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**'] },

  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Относительный импорт в чужой пакет (`../../parsing/src`) — в обход package.json.
  {
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
          noWarnOnMultipleProjects: true,
        }),
      ],
    },
    rules: {
      'import-x/no-relative-packages': 'error',
    },
  },

  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    ignores: ['apps/web/src/viewer/**'],
    rules: restrict(CESIUM),
  },
  {
    files: ['packages/**'],
    rules: restrict(CESIUM, APPS_FROM_PACKAGES),
  },
  {
    files: ['packages/core/**'],
    rules: restrict(coreOnly('zod')),
  },
  {
    files: ['packages/core/**/*.test.ts'],
    rules: restrict(coreOnly('zod|vitest')),
  },
);
