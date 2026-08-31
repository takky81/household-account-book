/** インポート画面（決定表「CSVインポート」）。全行を先に検証してから投入する。 */

import { useState } from 'react';
import { Button, Card, ErrorText, Note, Tabs } from '../../components/ui';
import { createCategory, importTransactions, loadTransactions } from '../../lib/db';
import { useAuth, useWorkspace } from '../app/context';
import { analyzeImport, type ImportResult } from './import';
import { toCategoryLike } from '../app/model';

export function ImportPage() {
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;
  const [text, setText] = useState('');
  const [unknownCategory, setUnknownCategory] = useState<'create' | 'uncategorized'>('uncategorized');
  const [duplicates, setDuplicates] = useState<'import' | 'skip'>('skip');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function analyze(source: string) {
    setError('');
    setDone('');
    const existing = await loadTransactions({});
    const members: Record<string, ReturnType<typeof workspace.membersOf>> = {};
    for (const id of workspace.myGroupIds) members[id] = workspace.membersOf(id);
    setResult(
      analyzeImport(source, {
        selfId,
        profiles: workspace.profiles.map((p) => ({ id: p.id, displayName: p.display_name })),
        groups: workspace.groups,
        members,
        categories: workspace.categories.map(toCategoryLike),
        existing: existing.map((tx) => ({
          occurredOn: tx.occurred_on,
          categoryId: tx.category_id,
          amount: tx.amount,
          payerId: tx.payer_id,
          memo: tx.memo,
          splits: tx.transaction_splits.map((s) => ({ userId: s.user_id, amount: s.amount })),
        })),
        unknownCategory,
        duplicates,
      }),
    );
  }

  async function run() {
    if (result === null) return;
    setError('');
    try {
      // 未知のカテゴリを作る選択のときは、先に作ってから読み直す
      const toCreate = result.entries.flatMap((entry) =>
        entry.status === 'ok' && entry.payload.newCategory !== null ? [entry.payload.newCategory] : [],
      );
      const seen = new Set<string>();
      for (const category of toCreate) {
        const key = `${category.shareGroupId ?? ''}:${category.kind}:${category.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await createCategory({
          shareGroupId: category.shareGroupId,
          kind: category.kind,
          name: category.name,
          color: '#4a6fa5',
          sortOrder: 100,
        });
      }
      if (toCreate.length > 0) {
        await workspace.reload();
        await analyze(text);
        setDone('カテゴリを作りました。もう一度「取り込む」を押してください');
        return;
      }

      const rows = result.entries.flatMap((entry) =>
        entry.status === 'ok' && entry.payload.categoryId !== null
          ? [
              {
                categoryId: entry.payload.categoryId,
                occurredOn: entry.payload.occurredOn,
                amount: entry.payload.amount,
                payerId: entry.payload.payerId,
                memo: entry.payload.memo,
                splits: entry.payload.splits,
              },
            ]
          : [],
      );
      const inserted = await importTransactions(rows);
      setDone(`${inserted}件を取り込みました`);
      setResult(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '取り込めませんでした');
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 p-3">
      <h1 className="text-lg font-bold">インポート</h1>

      <Card className="flex flex-col gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV ファイル"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file === undefined) return;
            const source = await file.text();
            setText(source);
            await analyze(source);
          }}
        />
        <label className="flex flex-col gap-1 text-xs text-[var(--c-muted)]">
          CSV を貼り付けてもよい
          <textarea
            aria-label="CSV の中身"
            className="h-24 rounded border border-[var(--c-edge)] bg-[var(--c-panel)] p-2 text-sm text-[var(--c-ink)]"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <div>
            <span className="text-xs text-[var(--c-muted)]">未知のカテゴリ</span>
            <Tabs
              label="未知のカテゴリ"
              value={unknownCategory}
              onChange={setUnknownCategory}
              options={[
                { value: 'uncategorized', label: '未分類にする' },
                { value: 'create', label: '新規作成する' },
              ]}
            />
          </div>
          <div>
            <span className="text-xs text-[var(--c-muted)]">同じ内容の取引</span>
            <Tabs
              label="重複"
              value={duplicates}
              onChange={setDuplicates}
              options={[
                { value: 'skip', label: '飛ばす' },
                { value: 'import', label: '取り込む' },
              ]}
            />
          </div>
        </div>
        <Button onClick={() => void analyze(text)}>内容を確かめる</Button>
      </Card>

      <ErrorText>{error}</ErrorText>
      {done !== '' && <p className="text-sm text-[var(--c-income)]">{done}</p>}

      {result !== null && (
        <Card className="flex flex-col gap-2">
          <p className="text-sm" data-testid="import-summary">
            成功 {result.counts.ok} ／ 飛ばす {result.counts.skipped} ／ エラー {result.counts.error}
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--c-subtle)] text-left">
                <th className="p-1">行</th>
                <th className="p-1">判定</th>
                <th className="p-1">内容</th>
              </tr>
            </thead>
            <tbody>
              {result.entries.map((entry) => (
                <tr key={entry.line} className="border-t border-[var(--c-line)]">
                  <td className="p-1">{entry.line}</td>
                  <td
                    className={`p-1 ${entry.status === 'error' ? 'text-[var(--c-warn)]' : ''}`}
                  >
                    {entry.status === 'ok' ? '取り込む' : entry.status === 'skip' ? '飛ばす' : 'エラー'}
                  </td>
                  <td className="p-1">
                    {entry.status === 'ok'
                      ? `${entry.payload.occurredOn} ${entry.payload.amount}円`
                      : entry.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button disabled={result.counts.ok === 0} onClick={() => void run()}>
            {result.counts.ok}件を取り込む
          </Button>
        </Card>
      )}

      <Note>
        エラー行があっても、検証を通った行は取り込む。取り込めるのは取引 CSV だけ（§4.4）
      </Note>
    </main>
  );
}
