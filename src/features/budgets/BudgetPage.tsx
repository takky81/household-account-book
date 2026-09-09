/**
 * 予算画面（決定表「予算」）。実績は集計基準によらずカテゴリの支出総額。
 *
 * 予算は共有範囲ごとに置く（§3.7）。カテゴリは全ユーザー共通なので、同じ「食費」に
 * 共有の枠と個人の枠が並びうる。表は共有範囲を1つ選んで作る。
 */

import { useEffect, useMemo, useState } from 'react';
import { Button, Card, ErrorText, Meter, Tabs } from '../../components/ui';
import { MonthNav } from '../app/Layout';
import { addMonths, currentMonthKey, monthStart } from '../../lib/date';
import { formatAmount, parseAmount } from '../../lib/money';
import {
  deleteBudget,
  loadBudgets,
  loadMonthTransactions,
  saveBudget,
  type Budget,
  type Transaction,
} from '../../lib/db';
import { useAuth, useWorkspace } from '../app/context';
import { actualsByCategory, selfBurdenByCategory } from '../app/model';
import { budgetTotal, buildBudgetRows, copyBudgets, validateBudgetAmount } from './usage';

export function BudgetPage() {
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  /** 表に出す共有範囲。既定は先頭＝個人（§2.4） */
  const [scopeKeyValue, setScopeKeyValue] = useState(workspace.scopes[0]?.key ?? '');
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [previous, setPrevious] = useState<Budget[]>([]);
  const [rows, setRows] = useState<Transaction[]>([]);
  const [error, setError] = useState('');
  /** 対象月の予算を読み終えたか。読む前に表を出すと、入力欄が空で描かれてしまう */
  const [loaded, setLoaded] = useState(false);

  const reload = useMemo(
    () => async () => {
      const [now, before, txs] = await Promise.all([
        loadBudgets([monthKey]),
        loadBudgets([addMonths(monthKey, -1)]),
        loadMonthTransactions(monthKey),
      ]);
      setBudgets(now);
      setPrevious(before);
      setRows(txs);
    },
    [monthKey],
  );
  useEffect(() => {
    // 月を変えたら読み直す。読み終わるまで表は出さない。
    // 空の入力欄を先に出すと、値が届いた時点で入力欄が作り直され、
    // その間に打ち込んだ内容が消える
    setLoaded(false);
    void reload().finally(() => setLoaded(true));
  }, [reload]);

  const scope = workspace.scopes.find((s) => s.key === scopeKeyValue) ?? workspace.scopes[0] ?? null;
  const inScope = <T extends { share_group_id: string | null; owner_id: string | null }>(item: T) =>
    scope !== null &&
    item.share_group_id === scope.shareGroupId &&
    item.owner_id === scope.ownerId;

  const scopedRows = rows.filter(inScope);
  const budgetRows = buildBudgetRows({
    categories: workspace.tree,
    budgets: budgets
      .filter(inScope)
      .map((b) => ({ categoryId: b.category_id, amount: b.amount })),
    actuals: actualsByCategory(scopedRows),
    selfBurden: selfBurdenByCategory(scopedRows, selfId),
  });
  const total = budgetTotal(budgetRows);

  async function change(categoryId: string, text: string) {
    setError('');
    if (scope === null) return;
    if (text.trim() === '') {
      await deleteBudget({
        categoryId,
        month: monthStart(monthKey),
        shareGroupId: scope.shareGroupId,
        ownerId: scope.ownerId,
      });
      await reload();
      return;
    }
    const amount = parseAmount(text);
    const check = amount === null ? { ok: false as const, message: '予算は1以上の整数にしてください' } : validateBudgetAmount(amount);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    try {
      await saveBudget({
        categoryId,
        month: monthStart(monthKey),
        amount: amount!,
        shareGroupId: scope.shareGroupId,
        ownerId: scope.ownerId,
      });
      await reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存できませんでした');
    }
  }

  async function copyPrevious() {
    if (scope === null) return;
    // 複製するのは今見ている共有範囲の枠だけ。他の範囲の枠まで動かさない
    const entries = copyBudgets(
      previous
        .filter(inScope)
        .map((b) => ({ categoryId: b.category_id, month: b.month, amount: b.amount })),
      monthKey,
      budgets
        .filter(inScope)
        .map((b) => ({ categoryId: b.category_id, month: b.month, amount: b.amount })),
    );
    for (const entry of entries) {
      await saveBudget({ ...entry, shareGroupId: scope.shareGroupId, ownerId: scope.ownerId });
    }
    await reload();
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 p-3">
      <h1 className="text-lg font-bold">予算</h1>
      <MonthNav monthKey={monthKey} onChange={setMonthKey} />

      <Tabs
        label="共有範囲"
        value={scopeKeyValue}
        onChange={setScopeKeyValue}
        options={workspace.scopes.map((s) => ({ value: s.key, label: s.label }))}
      />

      <div>
        <Button variant="ghost" onClick={() => void copyPrevious()}>
          前月の予算を複製
        </Button>
      </div>

      <ErrorText>{error}</ErrorText>

      {!loaded && <p className="text-xs text-[var(--c-muted)]">読み込んでいます…</p>}

      {loaded && (
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--c-subtle)] text-left text-xs text-[var(--c-ink-soft)]">
              <th className="p-2">カテゴリ</th>
              <th className="p-2 text-right">予算</th>
              <th className="p-2 text-right">実績</th>
              <th className="p-2 text-right">残額</th>
              <th className="p-2 w-32">消化</th>
              <th className="p-2 text-right">自分の負担</th>
            </tr>
          </thead>
          <tbody>
            {budgetRows.map((row) => (
              <tr key={row.categoryId} className="border-t border-[var(--c-line)]">
                <td className="p-2">
                  {row.name}
                  {/* 小分類ごとの実績を内訳として出す（§5.6） */}
                  {row.children.length > 0 && (
                    <ul className="mt-0.5 flex flex-col gap-0.5 text-xs text-[var(--c-muted)]">
                      {row.children.map((child) => (
                        <li key={child.categoryId}>
                          └ {child.name} {formatAmount(child.actual)}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="p-2 text-right">
                  <input
                    aria-label={`${row.name}の予算`}
                    // 複製や削除で値が変わったら入力欄も引き直す
                    key={`${row.categoryId}-${row.budget ?? ''}`}
                    className="w-24 rounded border border-[var(--c-edge)] bg-[var(--c-panel)] px-1 py-0.5 text-right text-sm"
                    defaultValue={row.budget === null ? '' : String(row.budget)}
                    onBlur={(e) => void change(row.categoryId, e.target.value)}
                  />
                </td>
                <td className={`p-2 text-right tabular-nums ${row.over ? 'text-[var(--c-warn)]' : ''}`}>
                  {formatAmount(row.actual)}
                </td>
                <td className={`p-2 text-right tabular-nums ${row.over ? 'text-[var(--c-warn)]' : ''}`}>
                  {row.remaining === null ? '予算なし' : formatAmount(row.remaining)}
                </td>
                <td className="p-2">
                  <Meter rate={row.rate} over={row.over} />
                </td>
                <td className="p-2 text-right tabular-nums text-[var(--c-muted)]">
                  {formatAmount(row.selfBurden)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--c-line)] bg-[var(--c-subtle)] text-xs">
              <th className="p-2 text-left">{scope?.label ?? ''}の合計</th>
              <td className="p-2 text-right tabular-nums">{formatAmount(total.budget)}</td>
              <td className="p-2 text-right tabular-nums">{formatAmount(total.actual)}</td>
              <td className="p-2 text-right tabular-nums">{formatAmount(total.remaining)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </Card>
      )}
    </main>
  );
}
