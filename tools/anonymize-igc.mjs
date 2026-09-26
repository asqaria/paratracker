#!/usr/bin/env node
/**
 * Skyline — обезличивание реального IGC перед тем, как положить его в /fixtures.
 *
 * Треки пилотов — личные данные (tracks/ в .gitignore). В фикстуру реальный
 * файл попадает только с согласия владельца и только обезличенным: остаются
 * фиксы (B), их расширения (I) и то, что нужно парсеру и анализу — дата,
 * датум высоты, прибор и прошивка. Уходит всё, по чему можно узнать человека
 * или его снаряжение.
 *
 * Запуск:   node tools/anonymize-igc.mjs <вход.igc> <выход.igc>
 *
 * Убирается:
 *   A-запись  — серийный номер прибора (остаётся код производителя)
 *   HFPLT/HFCM2 — пилот и второй пилот
 *   HFGID/HFCID — бортовой и соревновательный номер
 *   HFGTY     — модель крыла
 *   HOSIT     — название места старта
 *   C-записи  — декларация задачи (названия точек)
 *   L-записи  — комментарии прибора и пилота
 *   G-запись  — подпись безопасности: после правки заголовка она всё равно неверна
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Запуск: node tools/anonymize-igc.mjs <вход.igc> <выход.igc>');
  process.exit(1);
}

/** H-записи с личными данными: трёхбуквенный код после H и источника (F/O/P). */
const PERSONAL_HEADERS = new Set(['PLT', 'CM2', 'GID', 'CID', 'GTY', 'SIT']);
/** Код производителя в A-записи — три символа после A; дальше серийный номер. */
const MANUFACTURER_LENGTH = 3;

const lines = readFileSync(input, 'utf8').split(/\r?\n/);
const kept = [];
const dropped = {};
for (const line of lines) {
  const type = line[0];
  if (type === 'A') {
    kept.push(`A${line.slice(1, 1 + MANUFACTURER_LENGTH)}000`);
    continue;
  }
  if (type === 'H' && PERSONAL_HEADERS.has(line.slice(2, 5))) {
    dropped[line.slice(0, 5)] = (dropped[line.slice(0, 5)] ?? 0) + 1;
    continue;
  }
  if (type === 'C' || type === 'L' || type === 'G') {
    dropped[type] = (dropped[type] ?? 0) + 1;
    continue;
  }
  kept.push(line);
}

writeFileSync(output, kept.join('\r\n'));
console.log(`${output}: оставлено строк ${kept.length}, убрано ${JSON.stringify(dropped)}`);
