/**
 * CSV の読み書き（docs/仕様書.md §4.1）。決定表「CSVインポート」「CSVエクスポート」に対応する。
 *
 * - UTF-8（書き出しは BOM 付き。Excel でそのまま開けるようにする）
 * - 改行は CRLF、区切りは `,`
 * - 値に `,` `"` 改行のいずれかを含む場合だけ `"` で囲み、内側の `"` は `""` にする
 */

const BOM = '﻿';

/** 1行ぶんのセル。ヘッダ名で引けるようにする。 */
export type CsvRow = Record<string, string>;

/** CSV のテキストを行と列に分ける。引用符の中の改行と区切りはそのまま持つ。 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      // CRLF も LF も1つの改行として扱う
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** 1行目をヘッダとして読み、ヘッダ名で引ける形にする。列の並び順は問わない。 */
export function parseCsvRows(text: string): { header: string[]; rows: CsvRow[] } {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => h.trim());
  const rows = table.slice(1).map((cells) => {
    const row: CsvRow = {};
    header.forEach((name, i) => {
      row[name] = cells[i] ?? '';
    });
    return row;
  });
  return { header, rows };
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 行の配列を CSV のテキストにする。BOM 付き UTF-8・CRLF。 */
export function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((cells) => cells.map(quote).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}

/** ヘッダ名と値の対応から CSV を作る。 */
export function toCsvFromObjects(header: string[], rows: CsvRow[]): string {
  return toCsv(
    header,
    rows.map((row) => header.map((name) => row[name] ?? '')),
  );
}
