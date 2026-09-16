import { describe, expect, it } from 'vitest';

import { decodeXmlEntities, lineLocator, readAttributes, scanXml } from './xml.js';

/** Протокол событий сканера строками — так ожидания читаются глазами. */
function events(text: string, collectingText = true): string[] {
  const log: string[] = [];
  scanXml(text, {
    collectingText,
    open: (name, attributes) => {
      const attrs = [...readAttributes(attributes)].map(([k, v]) => ` ${k}=${v}`).join('');
      log.push(`open ${name}${attrs}`);
    },
    close: (name) => log.push(`close ${name}`),
    text: (value) => {
      if (value.trim() !== '') log.push(`text ${value}`);
    },
  });
  return log;
}

describe('scanXml', () => {
  it('локальные имена без префикса, атрибуты в обоих видах кавычек, самозакрывающиеся теги', () => {
    expect(events(`<gx:Track a="1" gx:b='2'><gx:coord>1 2 3</gx:coord><br/><hr /></gx:Track>`)).toEqual([
      'open Track a=1 b=2',
      'open coord',
      'text 1 2 3',
      'close coord',
      'open br',
      'close br',
      'open hr',
      'close hr',
      'close Track',
    ]);
  });

  it('атрибут со знаком > внутри кавычек не рвёт тег', () => {
    expect(events('<n note="a > b">x</n>')).toEqual(['open n note=a > b', 'text x', 'close n']);
  });

  it('сущности в тексте и атрибутах раскодированы, неизвестные оставлены как есть', () => {
    expect(events('<n v="a&amp;b">&lt;&#1058;&#x0435;&unknown;&gt;</n>')).toEqual([
      'open n v=a&b',
      'text <Те&unknown;>',
      'close n',
    ]);
  });

  it('CDATA — текст как есть; комментарии и инструкции пропущены', () => {
    expect(events('<?xml version="1.0"?><!-- <a> --><n><![CDATA[x &amp; <y>]]></n>')).toEqual([
      'open n',
      'text x &amp; <y>',
      'close n',
    ]);
  });

  it('DOCTYPE с внутренними сущностями не раскрывается (XXE, billion laughs)', () => {
    const doc = '<!DOCTYPE r [<!ENTITY a "AAAA"><!ENTITY b "&a;&a;"><!ENTITY x SYSTEM "file:///etc/passwd">]><r>&b;&x;</r>';
    expect(events(doc)).toEqual(['open r', 'text &b;&x;', 'close r']);
  });

  it('оборванный документ и одиночный < не бросают', () => {
    expect(events('<a><b>te<xt')).toEqual(['open a', 'open b', 'text te<xt']);
    expect(() => events('<a x="unclosed><b>1</b>')).not.toThrow();
    expect(() => events('<<<>>>&&&;;;<!--')).not.toThrow();
  });

  it('без collectingText текст не передаётся', () => {
    expect(events('<a>skip</a>', false)).toEqual(['open a', 'close a']);
  });

  it('offset открывающего тега и номер строки по нему', () => {
    const text = '<a>\n  <b/>\r\n<c/>';
    const offsets: number[] = [];
    scanXml(text, { collectingText: false, open: (_, __, offset) => offsets.push(offset), close: () => {}, text: () => {} });

    const lineAt = lineLocator(text);
    expect(offsets.map(lineAt)).toEqual([1, 2, 3]);
  });
});

describe('decodeXmlEntities', () => {
  it('пять стандартных и числовые', () => {
    expect(decodeXmlEntities('&amp;&lt;&gt;&quot;&apos;&#65;&#x42;')).toBe(`&<>"'AB`);
  });

  it('невалидный код символа оставлен как есть', () => {
    expect(decodeXmlEntities('&#x110000;&#;')).toBe('&#x110000;&#;');
  });
});
