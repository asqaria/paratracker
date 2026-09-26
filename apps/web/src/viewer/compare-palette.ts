/** Палитра треков сравнения (задача 3.12) — данные трека, как палитра вариометра, а не цвета интерфейса. */

/**
 * Цвета треков — по порядку в сравнении. Различимы на спутнике, снегу и лесе;
 * первый — акцент интерфейса. Вариометр в сравнении не раскрашивается: цвет —
 * это пилот.
 */
export const COMPARE_COLORS = [
  '#4da3ff',
  '#ff5d73',
  '#ffd166',
  '#06d6a0',
  '#c77dff',
  '#ff9f1c',
  '#f8f9fa',
  '#00e5ff',
] as const;

export const compareColor = (index: number): string => COMPARE_COLORS[index % COMPARE_COLORS.length] ?? COMPARE_COLORS[0];
