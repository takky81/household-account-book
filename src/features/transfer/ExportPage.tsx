/** エクスポート画面（決定表「CSVエクスポート」）。期間を選べるのは取引と予算だけ。 */

import { useState } from 'react';
import { Button, Card, Tabs } from '../../components/ui';
import { currentMonthKey, monthEnd, monthStart } from '../../lib/date';
import { loadBudgets, loadTransactions } from '../../lib/db';
import { useWorkspace } from '../app/context';
import { downloadCsv, toExportTx } from '../app/model';
import {
  budgetCsv,
  canSpecifyPeriod,
  categoryCsv,
  filterByMonth,
  groupCsv,
  transactionCsv,
  type ExportTarget,
} from './export';
import { MonthNav } from '../app/Layout';

const TARGETS: { value: ExportTarget; label: string }[] = [
  { value: 'transactions', label: '取引' },
  { value: 'categories', label: 'カテゴリ' },
  { value: 'budgets', label: '予算' },
  { value: 'groups', label: '共有グループ' },
];

export function ExportPage() {
  const workspace = useWorkspace();
  const [target, setTarget] = useState<ExportTarget>('transactions');
  const [period, setPeriod] = useState<'all' | 'month'>('all');
  const [monthKey, setMonthKey] = useState(currentMonthKey());

  const names = Object.fromEntries(workspace.profiles.map((p) => [p.id, p.display_name]));
  const groupNames = Object.fromEntries(workspace.groups.map((g) => [g.id, g.name]));

  async function run() {
    const month = period === 'month' ? monthKey : null;
    if (target === 'transactions') {
      const rows = await loadTransactions(
        month === null ? {} : { from: monthStart(month), to: monthEnd(month) },
      );
      const text = transactionCsv(
        filterByMonth(toExportTx(rows, workspace.categories), month),
        names,
        groupNames,
      );
      downloadCsv('取引.csv', text);
      return;
    }
    if (target === 'categories') {
      const text = categoryCsv(
        workspace.categories.map((c) => ({
          id: c.id,
          shareGroupId: c.share_group_id,
          ownerId: c.owner_id,
          kind: c.kind,
          name: c.name,
          isArchived: c.is_archived,
          color: c.color,
          sortOrder: c.sort_order,
          isSystem: c.is_system,
        })),
        groupNames,
      );
      downloadCsv('カテゴリ.csv', text);
      return;
    }
    if (target === 'budgets') {
      const budgets = await loadBudgets(month === null ? allMonths() : [month]);
      const text = budgetCsv(
        budgets.map((b) => ({ categoryId: b.category_id, month: b.month, amount: b.amount })),
        workspace.categories.map((c) => ({
          id: c.id,
          shareGroupId: c.share_group_id,
          ownerId: c.owner_id,
          kind: c.kind,
          name: c.name,
          isArchived: c.is_archived,
        })),
        groupNames,
      );
      downloadCsv('予算.csv', text);
      return;
    }
    const members = Object.fromEntries(
      workspace.groups.map((g) => [g.id, workspace.membersOf(g.id)]),
    );
    downloadCsv('共有グループ.csv', groupCsv(workspace.groups, members, names));
  }

  /** 全期間の予算を取るための月の一覧。予算は月ごとの行なので、範囲で引く。 */
  function allMonths(): string[] {
    const now = new Date();
    const months: string[] = [];
    for (let i = -36; i <= 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 p-3">
      <h1 className="text-lg font-bold">エクスポート</h1>

      <Card className="flex flex-col gap-3">
        <Tabs label="対象" value={target} onChange={setTarget} options={TARGETS} />

        {canSpecifyPeriod(target) ? (
          <>
            <Tabs
              label="期間"
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'all', label: '全期間' },
                { value: 'month', label: '対象月' },
              ]}
            />
            {period === 'month' && <MonthNav monthKey={monthKey} onChange={setMonthKey} />}
          </>
        ) : (
          <p className="text-xs text-[var(--c-muted)]">期間の指定なし</p>
        )}

        <Button onClick={() => void run()}>書き出す</Button>
      </Card>
    </main>
  );
}
