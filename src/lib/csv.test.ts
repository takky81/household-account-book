import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvRows, toCsv } from './csv';

describe('parseCsv', () => {
  it('列3 列はヘッダ名で解決するので並び順を問わない', () => {
    const { rows } = parseCsvRows('金額,日付\r\n1000,2026-08-31\r\n');
    expect(rows[0]).toEqual({ 日付: '2026-08-31', 金額: '1000' });
  });

  it('引用符の中の区切りと改行はそのまま持つ', () => {
    const table = parseCsv('a,"b,c","d\ne"\r\n');
    expect(table[0]).toEqual(['a', 'b,c', 'd\ne']);
  });

  it('二重の引用符は1つに戻す', () => {
    expect(parseCsv('"言""葉"\r\n')[0]).toEqual(['言"葉']);
  });

  it('BOM を落として読む', () => {
    const { header } = parseCsvRows('﻿日付,金額\r\n');
    expect(header[0]).toBe('日付');
  });

  it('LF だけの改行も読む', () => {
    expect(parseCsv('a,b\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('toCsv', () => {
  it('列5 BOM 付き UTF-8 と CRLF で書く', () => {
    const text = toCsv(['日付'], [['2026-08-31']]);
    expect(text.startsWith('﻿')).toBe(true);
    expect(text).toBe('﻿日付\r\n2026-08-31\r\n');
  });

  it('列4 区切りと引用符を含む値を囲む', () => {
    const text = toCsv(['備考'], [['ス,ーパー']], );
    expect(text).toContain('"ス,ーパー"');
    expect(toCsv(['備考'], [['言"葉']])).toContain('"言""葉"');
  });

  it('列10 0件でもヘッダを書く', () => {
    expect(toCsv(['日付', '金額'], [])).toBe('﻿日付,金額\r\n');
  });
});
