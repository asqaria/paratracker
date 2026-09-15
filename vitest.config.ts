import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

// Интеграционные тесты берут DATABASE_URL и S3_* из корневого .env, если он есть.
// Уже заданные переменные (CI) loadEnvFile не перезаписывает. Воркеры наследуют окружение.
const envFile = resolve(import.meta.dirname, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Единый конфиг Vitest: каждый пакет — отдельный проект.
// Из корня `pnpm vitest` гоняет всё; в пакете `test` фильтрует свой проект.
export default defineConfig({
  test: {
    // Без явного root глоб проектов считается от cwd пакета и ничего не находит.
    root: import.meta.dirname,
    projects: ['apps/*', 'packages/*'],
  },
});
