/** 集計画面（決定表「集計」）。対象範囲 × 集計基準の2軸で見る。 */

import { useEffect, useMemo, useState } from 'react';
import { Card, ScopeTag, Tabs } from '../../components/ui';
import { MonthNav } from '../app/Layout';
import { addMonths, currentMonthKey } from '../../lib/date';
import { formatAmount } from '../../lib/money';
import { loadTransactions, type Transaction } from '../../lib/db';
import { monthEnd, monthStart } from '../../lib/date';
import { useAuth, useWorkspace } from '../app/context';
import { SHARED_PAYER, aggregateMonth, monthDiff, type Basis, type ScopeFilter } from './aggregate';
import { toAggregateTx } from '../app/model';

const MONTHS_IN_CHART = 6;

export function AggregatePage() {
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [scopeValue, setScopeValue] = useState<'all' | 'own' | string>('all');
  const [basis, setBasis] = useState<Basis>('burden');
  const [rows, setRows] = useState<Transaction[]>([]);

  const first = addMonths(monthKey, -(MONTHS_IN_CHART - 1));
  useEffect(() => {
    void (async () => {
      setRows(await loadTransactions({ from: monthStart(first), to: monthEnd(monthKey) }));
    })();
  }, [first, monthKey]);

  const members = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const group of workspace.groups) {
      map[group.id] = workspace.membersOf(group.id).map((m) => m.userId);
    }
    return map;
  }, [workspace]);

  const scope: ScopeFilter =
    scopeValue === 'all'
      ? { kind: 'all' }
      : scopeValue === 'own'
        ? { kind: 'own' }
        : { kind: 'group', shareGroupId: scopeValue };

  const transactions = toAggregateTx(rows, workspace.categories);
  const common = { transactions, scope, basis, selfId, members };
  const totals = aggregateMonth({ ...common, monthKey });
  const previous = aggregateMonth({ ...common, monthKey: addMonths(monthKey, -1) });

  const history = Array.from({ length: MONTHS_IN_CHART }, (_, i) => {
    const key = addMonths(monthKey, -(MONTHS_IN_CHART - 1 - i));
    return { key, total: aggregateMonth({ ...common, monthKey: key }).expense };
  });
  const peak = Math.max(1, ...history.map((h) => h.total));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 p-3">
      <h1 className="text-lg font-bold">集計</h1>
      <MonthNav monthKey={monthKey} onChange={setMonthKey} />

      <div className="flex flex-wrap gap-3">
        <Tabs
          label="対象範囲"
          value={scopeValue}
          onChange={setScopeValue}
          options={[
            { value: 'all', label: '自分に関わるすべて' },
            ...workspace.groups.map((g) => ({ value: g.id, label: g.name })),
            { value: 'own', label: '個人のみ' },
          ]}
        />
        <Tabs
          label="集計基準"
          value={basis}
          onChange={setBasis}
          options={[
            { value: 'burden', label: '負担額' },
            { value: 'payment', label: '支払額' },
          ]}
        />
      </div>

      <Card>
        <div className="flex justify-between text-sm">
          <span>収入</span>
          <span data-testid="income">{formatAmount(totals.income)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>支出</span>
          <span data-testid="expense">{formatAmount(totals.expense)}</span>
        </div>
        <div className="flex justify-between text-sm font-bold">
          <span>収支</span>
          <span>{formatAmount(totals.balance)}</span>
        </div>
        <p className="mt-1 text-xs text-[var(--c-muted)]">
          前月比 {formatAmount(monthDiff(totals, previous))}
        </p>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-bold">カテゴリ別の内訳</h2>
        {totals.byCategory.length === 0 && (
          <p className="text-xs text-[var(--c-muted)]">この月の取引はありません</p>
        )}
        <ul className="flex flex-col gap-1">
          {totals.byCategory.map((row) => (
            <li key={row.categoryId} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1">
                <ScopeTag
                  label={
                    row.shareGroupId === null ? '個人' : workspace.groupName(row.shareGroupId)
                  }
                  kind={row.shareGroupId === null ? 'own' : 'group'}
                />
                {row.name}
              </span>
              <span className="tabular-nums">{formatAmount(row.amount)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-bold">月次の推移</h2>
        <div className="flex h-24 items-end gap-2">
          {history.map((month) => (
            <div key={month.key} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-[var(--c-bar)]"
                style={{ height: `${(month.total / peak) * 100}%` }}
                title={`${month.key} ${formatAmount(month.total)}`}
              />
              <span className="text-[10px] text-[var(--c-muted)]">{month.key.slice(5)}</span>
            </div>
          ))}
        </div>
      </Card>

      {scope.kind === 'group' && (
        <Card>
          <h2 className="mb-2 text-sm font-bold">人別</h2>
          <ul className="flex flex-col gap-1">
            {totals.byUser.map((row) => (
              <li key={row.userId} className="flex justify-between text-sm">
                <span>
                  {row.userId === SHARED_PAYER ? '共用' : workspace.displayName(row.userId)}
                </span>
                <span className="tabular-nums">{formatAmount(row.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
