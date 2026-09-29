import { defineProject } from 'vitest/config';

/**
 * Тесты db — интеграционные, на одной живой базе. Параллельно файлы мешали
 * друг другу: requeueFlightsForBackfill из logbook.test возвращал в pending
 * готовые полёты соседних файлов (analysis.test, stats.test мигали на CI и
 * локально). По очереди — медленнее на секунды, зато детерминированно.
 */
export default defineProject({
  test: {
    name: '@skyline/db',
    fileParallelism: false,
  },
});
