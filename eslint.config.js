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

/** Слой приложения: чистые функции над данными (CLAUDE.md, ТЗ §4.2). */
const PURE_PACKAGES = ['packages/parsing/**', 'packages/analysis/**', 'packages/track-format/**'];

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

/**
 * Белый список: запрещено всё, кроме относительных импортов и перечисленных модулей
 * (с подпутями: `zod/mini` — да, `zodx` — нет). Вместо `/` в именах — `.`.
 *
 * @param {string} allowed альтернативы через `|`
 * @param {string} message
 * @returns {Ban}
 */
const allowOnly = (allowed, message) => ({
  regex: `^(?!(?:${allowed})(?![\\w-])|[.])`,
  message,
});

const CORE_MESSAGE =
  'packages/core не зависит ни от чего: ни от пакетов, ни от apps, ни от Node API (ТЗ §4.2).';

const PURE_MESSAGE =
  'parsing, analysis и track-format зависят только от @skyline/core: без БД, сети и ФС — ' +
  'чистые функции, которые гоняются в worker_threads (CLAUDE.md, «Зависимости между пакетами»).';

/** Глобалы ввода-вывода: в чистых пакетах их не должно быть даже без импорта. */
const IO_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'process', 'require'].map(
  (name) => ({ name, message: PURE_MESSAGE }),
);

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
    rules: restrict(allowOnly('zod', CORE_MESSAGE)),
  },
  {
    files: ['packages/core/**/*.test.ts'],
    rules: restrict(allowOnly('zod|vitest', CORE_MESSAGE)),
  },

  // Новая зависимость здесь — осознанное решение: добавляется в список на ревью.
  {
    files: PURE_PACKAGES,
    rules: {
      ...restrict(allowOnly('@skyline.core', PURE_MESSAGE)),
      'no-restricted-globals': ['error', ...IO_GLOBALS],
    },
  },
  {
    files: PURE_PACKAGES.map((glob) => `${glob}/*.test.ts`),
    rules: {
      // Тесты читают эталоны из /fixtures — им файловая система нужна.
      ...restrict(allowOnly('@skyline.core|vitest|node:fs|node:path|node:url', PURE_MESSAGE)),
      'no-restricted-globals': ['error', ...IO_GLOBALS],
    },
  },
);
