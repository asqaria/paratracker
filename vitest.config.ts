import { defineConfig } from 'vitest/config';

// Единый конфиг Vitest: каждый пакет — отдельный проект.
// Из корня `pnpm vitest` гоняет всё; в пакете `test` фильтрует свой проект.
export default defineConfig({
  test: {
    // Без явного root глоб проектов считается от cwd пакета и ничего не находит.
    root: import.meta.dirname,
    projects: ['apps/*', 'packages/*'],
  },
});
