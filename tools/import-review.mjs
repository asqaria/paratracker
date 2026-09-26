#!/usr/bin/env node
/**
 * Сверка термиков владельцем (DoD фазы 2) → регрессионная фикстура.
 *
 *   node tools/import-review.mjs <трек.igc> <разметка.labels.json> <имя>
 *
 * Разметку скачивают на странице сверки («Скачать разметку») или из
 * GET /api/v1/flights/{id}/review/labels.json. Трек обезличивается
 * (tools/anonymize-igc.mjs) и кладётся в /fixtures как <имя>.igc, разметка —
 * <имя>.labels.json. Тест детекции термиков (packages/analysis/src/thermals.test.ts)
 * подхватывает все *.labels.json сам.
 *
 * Реальный трек — личные данные: только с согласия владельца.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'fixtures');
const NAME = /^[a-z0-9][a-z0-9-]*$/;

const [igc, labelsPath, name] = process.argv.slice(2);
if (!igc || !labelsPath || !name) {
  console.error('Запуск: node tools/import-review.mjs <трек.igc> <разметка.labels.json> <имя>');
  process.exit(1);
}
if (!NAME.test(name)) {
  console.error(`Имя фикстуры — латиница, цифры и дефис: ${name}`);
  process.exit(1);
}

const igcOut = join(FIXTURES, `${name}.igc`);
const labelsOut = join(FIXTURES, `${name}.labels.json`);
if (existsSync(igcOut) || existsSync(labelsOut)) {
  console.error(`Фикстура ${name} уже есть — fixtures только растут, существующие не перезаписываются.`);
  process.exit(1);
}

const labels = JSON.parse(readFileSync(labelsPath, 'utf8'));
for (const key of ['confirmed', 'missed', 'notThermals']) {
  if (!Array.isArray(labels[key])) {
    console.error(`В разметке нет списка ${key} — это не файл со страницы сверки.`);
    process.exit(1);
  }
}

execFileSync(process.execPath, [join(ROOT, 'tools/anonymize-igc.mjs'), igc, igcOut], { stdio: 'inherit' });
writeFileSync(labelsOut, `${JSON.stringify({ ...labels, file: `${name}.igc` }, null, 2)}\n`, 'utf8');

console.log(
  `${name}: подтверждённых ${labels.confirmed.length}, пропущенных ${labels.missed.length}, ` +
    `не термиков ${labels.notThermals.length} → fixtures/${name}.{igc,labels.json}`,
);
