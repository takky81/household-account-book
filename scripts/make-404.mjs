/**
 * GitHub Pages 用の 404 フォールバックを作る。
 *
 * Pages は静的配信なので `/household-account-book/budget` のような URL を直接開くと
 * 404 を返す。index.html と同じ中身を 404.html に置いておくと、Pages はそれを返し、
 * URL はそのままなのでルータが本来の画面を出せる（docs/仕様書.md §2.2 /
 * 決定表「表示設定と共通の振る舞い」列5）。
 */

import { copyFileSync, existsSync } from 'node:fs';

const index = 'dist/index.html';
const fallback = 'dist/404.html';

if (!existsSync(index)) {
  console.error(`${index} がありません。先に vite build を走らせてください。`);
  process.exit(1);
}

copyFileSync(index, fallback);
console.log(`${fallback} を作りました`);
