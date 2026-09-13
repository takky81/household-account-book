/**
 * 決定表の列がテストで押さえられているかを数える。
 *
 * 各表に対応するテストファイルを決めておき、その中に「列N」の記述が
 * あるかどうかで判定する。テスト名の付け方（「列3 …」）を頼りにした
 * 粗い確認だが、抜けた列に気づくには足りる。
 *
 *   node --experimental-strip-types spec/coverage.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TABLES_DIR = join(ROOT, 'spec', 'tables');

/** 表ごとに、その列を確かめているテストファイル。 */
const SOURCES: Record<string, string[]> = {
  認証: ['e2e/auth.spec.ts', 'src/features/auth/validation.test.ts'],
  共有グループの管理: [
    'e2e/group.spec.ts',
    'src/features/groups/members.test.ts',
    'supabase/tests/01-basics.test.sql',
    'supabase/tests/04-groups.test.sql',
  ],
  カテゴリの管理: [
    'e2e/category.spec.ts',
    'e2e/scope.spec.ts',
    'src/features/categories/name.test.ts',
    'src/features/categories/order.test.ts',
    'src/features/categories/tree.test.ts',
    'supabase/tests/06-subcategory.test.sql',
    'supabase/tests/08-category-master.test.sql',
  ],
  取引の入力と編集: [
    'e2e/transaction.spec.ts',
    'src/features/transactions/validation.test.ts',
    'src/lib/money.test.ts',
    'supabase/tests/02-access.test.sql',
  ],
  負担の按分: ['src/lib/split.test.ts', 'e2e/transaction.spec.ts', 'supabase/tests/01-basics.test.sql'],
  共有範囲の変更: [
    'e2e/scope.spec.ts',
    'src/features/scope/move.test.ts',
    'supabase/tests/03-scope-move.test.sql',
    'supabase/tests/06-subcategory.test.sql',
  ],
  CSVインポート: ['e2e/import.spec.ts', 'src/lib/csv.test.ts', 'src/features/transfer/import.test.ts'],
  CSVエクスポート: ['e2e/export.spec.ts', 'src/lib/csv.test.ts', 'src/features/transfer/export.test.ts'],
  集計: ['src/features/aggregate/aggregate.test.ts', 'e2e/aggregate.spec.ts', 'src/lib/paged.test.ts'],
  予算: [
    'src/features/budgets/usage.test.ts',
    'e2e/budget.spec.ts',
    'supabase/tests/02-access.test.sql',
    'supabase/tests/06-subcategory.test.sql',
  ],
  アクセス制御: [
    'e2e/access.spec.ts',
    'supabase/tests/01-basics.test.sql',
    'supabase/tests/02-access.test.sql',
  ],
  定期登録ルールの管理: [
    'e2e/recurring.spec.ts',
    'src/features/recurring/validation.test.ts',
    'supabase/tests/07-recurring.test.sql',
  ],
  定期登録の生成: [
    'e2e/recurring.spec.ts',
    'src/features/recurring/schedule.test.ts',
    'supabase/tests/07-recurring.test.sql',
  ],
  表示設定と共通の振る舞い: [
    'e2e/ui.spec.ts',
    'src/lib/theme.test.ts',
    'src/lib/submitGuard.test.ts',
    'src/lib/contrast.test.ts',
    'src/components/ConfirmDialog.test.tsx',
  ],
};

type Column = { table: string; col: number };

const columns: Column[] = [];
for (const file of readdirSync(TABLES_DIR).filter((f) => f.endsWith('.jsonl'))) {
  for (const line of readFileSync(join(TABLES_DIR, file), 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const row = JSON.parse(line) as Column;
    columns.push({ table: row.table, col: row.col });
  }
}

const cache = new Map<string, string>();
function textOf(path: string): string {
  const found = cache.get(path);
  if (found !== undefined) return found;
  let content = '';
  try {
    content = readFileSync(join(ROOT, path), 'utf8');
  } catch {
    content = '';
  }
  cache.set(path, content);
  return content;
}

const missing: Column[] = [];
for (const column of columns) {
  const sources = SOURCES[column.table] ?? [];
  // 「列3」の直後に別の数字が続くものは別の列なので外す
  const pattern = new RegExp(`列${column.col}(?![0-9])`);
  const covered = sources.some((path) => {
    // DB のテスト（.sql）は1ファイルで複数の表を確かめるため、
    // 表の名前と列番号が同じ行に並んでいることを求める。
    // ユニット/E2E は表ごとにファイルを分けるので、ファイル全体を見れば足りる。
    if (path.endsWith('.sql')) {
      return textOf(path)
        .split('\n')
        .some((line) => line.includes(column.table) && pattern.test(line));
    }
    return pattern.test(textOf(path));
  });
  if (!covered) missing.push(column);
}

const byTable = new Map<string, number>();
for (const column of columns) byTable.set(column.table, (byTable.get(column.table) ?? 0) + 1);

for (const [table, total] of byTable) {
  const lack = missing.filter((m) => m.table === table);
  const mark = lack.length === 0 ? 'OK ' : 'NG ';
  const detail = lack.length === 0 ? '' : ` 未カバー: ${lack.map((m) => `列${m.col}`).join(' ')}`;
  console.log(`${mark}${table} ${total - lack.length}/${total}${detail}`);
}

console.log(`\n合計 ${columns.length - missing.length}/${columns.length} 列`);
if (missing.length > 0) process.exitCode = 1;
