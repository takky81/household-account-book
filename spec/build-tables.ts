/**
 * tables/*.jsonl から決定表の表示用HTMLを生成する。
 *
 *   node --experimental-strip-types build-tables.ts
 *
 * 生成物は dist/index.html。リポジトリにはコミットしない。
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TABLES_DIR = join(HERE, "tables");
const OUT_DIR = join(HERE, "dist");

/** ブロック。行がブロックの要素、列が1条件を表す。 */
const BLOCKS = ["conditions", "actions", "results", "unit", "e2e"] as const;
type Block = (typeof BLOCKS)[number];

const BLOCK_LABEL: Record<Block, string> = {
  conditions: "条件",
  actions: "操作",
  results: "結果",
  unit: "ユニットテスト",
  e2e: "E2Eテスト",
};

/** 1行 = 1列。○×ではなく行タイトルをそのまま持つ。 */
type Cells = { true?: string[]; false?: string[] };
type Column = {
  table: string;
  col: number;
  note?: string;
} & Partial<Record<Block, Cells | string[]>>;

/** 配列で書かれたブロックは全て成立（true）とみなす。 */
function normalize(v: Cells | string[] | undefined): Cells {
  if (!v) return {};
  return Array.isArray(v) ? { true: v } : v;
}

type Mark = "yes" | "no" | "";

function readColumns(): Column[] {
  const out: Column[] = [];
  for (const name of readdirSync(TABLES_DIR).filter((f) => f.endsWith(".jsonl")).sort()) {
    const text = readFileSync(join(TABLES_DIR, name), "utf8");
    text.split("\n").forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith("//")) return;
      try {
        out.push(JSON.parse(t) as Column);
      } catch (e) {
        throw new Error(`${name}:${i + 1} をJSONとして読めない: ${(e as Error).message}`);
      }
    });
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 行タイトルは "出題順:自動" のようなコロン区切りの1文字列。先頭のコロンで2列に割る。 */
function splitTitle(title: string): [string, string] | [string] {
  const i = title.indexOf(":");
  if (i < 0) return [title];
  return [title.slice(0, i).trim(), title.slice(i + 1).trim()];
}

type Row = { title: string; marks: Map<number, Mark> };

function buildTable(name: string, columns: Column[]) {
  const cols = [...columns].sort((a, b) => a.col - b.col);
  const seen = new Set<number>();
  for (const c of cols) {
    if (seen.has(c.col)) throw new Error(`決定表「${name}」に列 ${c.col} が重複している`);
    seen.add(c.col);
  }

  // 行はブロックごとに、初出の順に並べる。
  const rowsByBlock = new Map<Block, Row[]>();
  for (const block of BLOCKS) {
    const rows: Row[] = [];
    const index = new Map<string, Row>();
    for (const c of cols) {
      const cells = normalize(c[block]);
      for (const [mark, titles] of [["yes", cells.true], ["no", cells.false]] as const) {
        for (const title of titles ?? []) {
          let row = index.get(title);
          if (!row) {
            row = { title, marks: new Map() };
            index.set(title, row);
            rows.push(row);
          }
          if (row.marks.has(c.col)) {
            throw new Error(`決定表「${name}」列 ${c.col} で行「${title}」が重複している`);
          }
          row.marks.set(c.col, mark);
        }
      }
    }
    if (rows.length) rowsByBlock.set(block, rows);
  }
  return { name, cols, rowsByBlock };
}

type BuiltTable = ReturnType<typeof buildTable>;

function renderTable(t: BuiltTable, id: string): string {
  const colNums = t.cols.map((c) => c.col);
  const head = colNums.map((n) => `<th class="c" data-col="${n}">${n}</th>`).join("");
  const notes = t.cols.some((c) => c.note)
    ? `<tr class="notes"><th colspan="3"></th>${t.cols
        .map((c) => `<th class="c note" data-col="${c.col}" title="${esc(c.note ?? "")}">${c.note ? "※" : ""}</th>`)
        .join("")}</tr>`
    : "";

  // ブロック名と第1タイトルは全行に出しておき、連続する重複は表示時に伏せる。
  // 列で絞り込んでもセルの結合が崩れないようにするため。
  const body: string[] = [];
  for (const block of BLOCKS) {
    const rows = t.rowsByBlock.get(block);
    if (!rows) continue;
    for (const row of rows) {
      const parts = splitTitle(row.title);
      const active = colNums.filter((n) => row.marks.get(n));
      const cells = colNums
        .map((n) => {
          const m = row.marks.get(n);
          return `<td class="c ${m ?? "none"}" data-col="${n}">${m === "yes" ? "○" : m === "no" ? "×" : ""}</td>`;
        })
        .join("");
      const grp = parts.length === 2 ? parts[0] : "";
      const titleCells =
        parts.length === 2
          ? `<th class="t blk">${BLOCK_LABEL[block]}</th><th class="t grp">${esc(parts[0])}</th><th class="t sub">${esc(parts[1])}</th>`
          : `<th class="t blk">${BLOCK_LABEL[block]}</th><th class="t full" colspan="2">${esc(parts[0])}</th>`;
      body.push(
        `<tr class="b-${block}" data-block="${block}" data-grp="${esc(grp)}" data-cols="${active.join(",")}">${titleCells}${cells}</tr>`,
      );
    }
  }

  const noteList = t.cols
    .filter((c) => c.note)
    .map((c) => `<li><b>${c.col}</b> ${esc(c.note ?? "")}</li>`)
    .join("");

  return `
<section class="tbl" id="${id}">
  <h2>${esc(t.name)}</h2>
  <div class="filter">
    <label>列番号 <input type="number" min="1" placeholder="全部" data-for="${id}"></label>
    <span class="hint">入力するとその列に関係する行だけを表示</span>
  </div>
  <div class="scroll">
    <table>
      <thead><tr><th colspan="3" class="corner">${esc(t.name)}</th>${head}</tr>${notes}</thead>
      <tbody>${body.join("")}</tbody>
    </table>
  </div>
  ${noteList ? `<ul class="notes-list">${noteList}</ul>` : ""}
</section>`;
}

const CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 28px 80px; font-family: "Hiragino Sans", "Yu Gothic", system-ui, sans-serif;
  background: #fbfbf9; color: #23231f; line-height: 1.6; }
h1 { font-size: 22px; margin: 0 0 6px; }
.lead { color: #6b6a62; font-size: 13px; margin: 0 0 28px; }
nav { margin: 0 0 32px; padding: 14px 18px; border: 1px solid #d8d6cc; border-radius: 6px; background: #fff; }
nav ul { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px 18px; }
nav a { color: #23231f; font-size: 13px; }
.tbl { margin: 0 0 44px; }
h2 { font-size: 17px; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 2px solid #23231f; }
.filter { display: flex; align-items: center; gap: 12px; margin: 0 0 10px; font-size: 13px; }
.filter input { width: 88px; padding: 5px 8px; font: inherit; border: 1px solid #a8a69c; border-radius: 4px; background: #fff; }
.hint { color: #8a887d; font-size: 12px; }
.scroll { overflow-x: auto; border: 1px solid #d8d6cc; border-radius: 6px; background: #fff; }
table { border-collapse: collapse; font-size: 13px; width: 100%; }
th, td { border: 1px solid #e2e0d7; padding: 6px 10px; text-align: left; font-weight: normal; vertical-align: middle; }
thead th { background: #f2f1ea; font-size: 12px; color: #6b6a62; position: sticky; top: 0; }
.corner { min-width: 260px; }
th.c, td.c { text-align: center; width: 42px; min-width: 42px; }
td.yes { font-weight: bold; }
td.no { color: #8a887d; }
th.t { background: #fafaf7; }
th.blk { width: 96px; min-width: 96px; white-space: nowrap; font-size: 12px; }
th.grp { white-space: nowrap; }
th.sub { padding-left: 12px; }
th.dup { color: transparent; border-top-color: transparent; }
tr.b-conditions td { background: #f4f8fd; }
tr.b-conditions th.t { background: #e7eff8; }
tr.b-conditions th.blk { background: #d2e1f1; }
tr.b-actions td { background: #f4faf5; }
tr.b-actions th.t { background: #e7f1e8; }
tr.b-actions th.blk { background: #d1e5d4; }
tr.b-results td { background: #fdf9ef; }
tr.b-results th.t { background: #f9f0dd; }
tr.b-results th.blk { background: #f0e1bf; }
tr.b-unit td { background: #f9f6fc; }
tr.b-unit th.t { background: #efe9f4; }
tr.b-unit th.blk { background: #e0d6ea; }
tr.b-e2e td { background: #fdf5f4; }
tr.b-e2e th.t { background: #f7e8e7; }
tr.b-e2e th.blk { background: #ecd6d3; }
tr.notes th { font-size: 11px; color: #8a887d; }
.notes-list { margin: 8px 0 0; padding-left: 20px; font-size: 12px; color: #6b6a62; }
.pick { background: #fdf0c9 !important; }
tr.hide { display: none; }
@media (prefers-color-scheme: dark) {
  body { background: #17171a; color: #e6e4dd; }
  nav, .scroll, .filter input { background: #202024; border-color: #3a3a40; }
  nav a { color: #e6e4dd; }
  thead th { background: #2a2a30; color: #a8a69c; }
  th, td { border-color: #34343a; }
  th.t { background: #1d1d21; }
  tr.b-conditions td { background: #1a222b; }
  tr.b-conditions th.t { background: #1e2a35; }
  tr.b-conditions th.blk { background: #27394a; }
  tr.b-actions td { background: #1a231d; }
  tr.b-actions th.t { background: #1e2c22; }
  tr.b-actions th.blk { background: #273e2d; }
  tr.b-results td { background: #292317; }
  tr.b-results th.t { background: #322b1b; }
  tr.b-results th.blk { background: #453a22; }
  tr.b-unit td { background: #241e2c; }
  tr.b-unit th.t { background: #2a2333; }
  tr.b-unit th.blk { background: #392f45; }
  tr.b-e2e td { background: #2a1d1f; }
  tr.b-e2e th.t { background: #322225; }
  tr.b-e2e th.blk { background: #452e32; }
  .pick { background: #4a3f1c !important; }
}
`;

const JS = `
function refresh(section, n) {
  var rows = Array.prototype.slice.call(section.querySelectorAll('tbody tr[data-cols]'));
  rows.forEach(function (tr) {
    var cols = tr.dataset.cols ? tr.dataset.cols.split(',') : [];
    tr.classList.toggle('hide', n !== null && cols.indexOf(n) === -1);
  });
  var lastBlock = null;
  var lastGrp = null;
  rows.forEach(function (tr) {
    if (tr.classList.contains('hide')) return;
    var blk = tr.querySelector('th.blk');
    var grp = tr.querySelector('th.grp');
    var sameBlock = tr.dataset.block === lastBlock;
    if (blk) blk.classList.toggle('dup', sameBlock);
    if (grp) grp.classList.toggle('dup', sameBlock && tr.dataset.grp !== '' && tr.dataset.grp === lastGrp);
    lastBlock = tr.dataset.block;
    lastGrp = tr.dataset.grp;
  });
  section.querySelectorAll('[data-col]').forEach(function (cell) {
    cell.classList.toggle('pick', n !== null && cell.dataset.col === n);
  });
}

document.querySelectorAll('.filter input').forEach(function (input) {
  var section = document.getElementById(input.dataset.for);
  refresh(section, null);
  input.addEventListener('input', function () {
    var raw = input.value.trim();
    refresh(section, raw === '' ? null : String(parseInt(raw, 10)));
  });
});
`;

function main() {
  const columns = readColumns();
  if (!columns.length) throw new Error("tables/*.jsonl に列が1つもない");

  const order: string[] = [];
  const grouped = new Map<string, Column[]>();
  for (const c of columns) {
    if (!grouped.has(c.table)) {
      grouped.set(c.table, []);
      order.push(c.table);
    }
    grouped.get(c.table)!.push(c);
  }

  const built = order.map((name) => buildTable(name, grouped.get(name)!));
  const sections = built.map((t, i) => renderTable(t, "t" + (i + 1)));
  const nav = built.map((t, i) => `<li><a href="#t${i + 1}">${esc(t.name)}</a></li>`).join("");

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>穴埋め学習アプリ 決定表</title>
<style>${CSS}</style>
</head>
<body>
<h1>穴埋め学習アプリ 決定表</h1>
<p class="lead">${built.length} 表 / ${columns.length} 列。tables/*.jsonl から生成。○ = 成立、× = 不成立、空欄 = どちらでもよい。</p>
<nav><ul>${nav}</ul></nav>
${sections.join("\n")}
<script>${JS}</script>
</body>
</html>
`;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "index.html"), html, "utf8");
  console.log(`dist/index.html を生成: ${built.length} 表 / ${columns.length} 列`);
}

main();
