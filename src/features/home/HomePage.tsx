/** ホーム画面。対象月の収支・予算の消化・直近の取引（§6）。 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Meter, ScopeTag } from '../../components/ui';
import { MonthNav } from '../app/Layout';
import { currentMonthKey, addMonths } from '../../lib/date';
import { formatAmount, formatSigned } from '../../lib/money';
import { loadBudgets, loadMonthTransactions, type Budget, type Transaction } from '../../lib/db';
import { useAuth, useWorkspace } from '../app/context';
import { aggregateMonth, monthDiff } from '../aggregate/aggregate';
import { actualsByCategory, selfBurdenByCategory, toAggregateTx } from '../app/model';
import { buildBudgetRows } from '../budgets/usage';
import { describeRecurringRun } from '../recurring/schedule';

export function HomePage() {
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [current, setCurrent] = useState<Transaction[]>([]);
  const [previous, setPrevious] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);

  useEffect(() => {
    void (async () => {
      const [now, before, plans] = await Promise.all([
        loadMonthTransactions(monthKey),
        loadMonthTransactions(addMonths(monthKey, -1)),
        loadBudgets([monthKey]),
      ]);
      setCurrent(now);
      setPrevious(before);
      setBudgets(plans);
    })();
  }, [monthKey]);

  const members = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const group of workspace.groups) {
      map[group.id] = workspace.membersOf(group.id).map((m) => m.userId);
    }
    return map;
  }, [workspace]);

  const totals = aggregateMonth({
    transactions: toAggregateTx(current, workspace.categories),
    monthKey,
    scope: { kind: 'all' },
    basis: 'burden',
    selfId,
    members,
  });
  const previousTotals = aggregateMonth({
    transactions: toAggregateTx(previous, workspace.categories),
    monthKey: addMonths(monthKey, -1),
    scope: { kind: 'all' },
    basis: 'burden',
    selfId,
    members,
  });

  const budgetRows = buildBudgetRows({
    categories: workspace.tree,
    budgets: budgets.map((b) => ({ categoryId: b.category_id, amount: b.amount })),
    actuals: actualsByCategory(current),
    selfBurden: selfBurdenByCategory(current, selfId),
  }).filter((row) => row.budget !== null);

  const recent = current.slice(0, 5);
  const recurring = workspace.recurringResult;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 p-3">
      <MonthNav monthKey={monthKey} onChange={setMonthKey} />

      {/* 起動時に作った取引を知らせる。黙って増やすと覚えのない取引に見える（§5.8） */}
      {recurring !== null && recurring.created + recurring.failed > 0 && (
        <p
          role="status"
          data-testid="recurring-notice"
          className="rounded-md border border-[var(--c-line)] bg-[var(--c-panel)] px-2 py-1 text-xs text-[var(--c-muted)]"
        >
          {describeRecurringRun(recurring)}
          {recurring.failed > 0 && (
            <Link className="ml-1 text-[var(--c-link)]" to="/recurring">
              定期登録を見る
            </Link>
          )}
        </p>
      )}

      <Card>
        <div className="flex justify-between text-sm">
          <span>収入</span>
          <span className="text-[var(--c-income)]">{formatSigned(totals.income, 'income')}</span>
        </div>
        <div className="mt-1 flex justify-between text-sm">
          <span>支出</span>
          <span className="text-[var(--c-expense)]">{formatSigned(totals.expense, 'expense')}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-dashed border-[var(--c-line)] pt-1 text-sm font-bold">
          <span>収支</span>
          <span data-testid="balance">{formatAmount(totals.balance)}</span>
        </div>
        <p className="mt-1 text-xs text-[var(--c-muted)]">
          負担額で見た自分の分。前月比 {formatAmount(monthDiff(totals, previousTotals))}
        </p>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-bold">予算</h2>
        {budgetRows.length === 0 && <p className="text-xs text-[var(--c-muted)]">予算なし</p>}
        <div className="flex flex-col gap-2">
          {budgetRows.map((row) => (
            <div key={row.categoryId} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1">{row.name}</span>
                <span className={row.over ? 'text-[var(--c-warn)]' : ''}>
                  {formatAmount(row.actual)} / {formatAmount(row.budget ?? 0)}
                </span>
              </div>
              <Meter rate={row.rate} over={row.over} />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-bold">直近の取引</h2>
        {recent.length === 0 && <p className="text-xs text-[var(--c-muted)]">まだありません</p>}
        <ul className="flex flex-col gap-1">
          {recent.map((tx) => {
            const category = workspace.categories.find((c) => c.id === tx.category_id);
            if (category === undefined) return null;
            return (
              <li key={tx.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1">
                  {/* 共有範囲は取引が持つ（§2.4） */}
                  <ScopeTag
                    label={workspace.scopeLabel(tx)}
                    kind={tx.share_group_id === null ? 'own' : 'group'}
                  />
                  {workspace.categoryPath(category.id)}
                  <span className="text-xs text-[var(--c-muted)]">
                    {workspace.displayName(tx.payer_id)}
                  </span>
                </span>
                <span
                  className={
                    category.kind === 'income' ? 'text-[var(--c-income)]' : 'text-[var(--c-expense)]'
                  }
                >
                  {formatSigned(tx.amount, category.kind)}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Link
        to="/new"
        className="rounded-md bg-[var(--c-ink)] px-3 py-2 text-center text-sm text-[var(--c-paper)]"
      >
        ＋ 取引を入力
      </Link>
    </main>
  );
}
