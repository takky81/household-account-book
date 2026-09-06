/** 集計画面（決定表「集計」）。対象範囲 × 集計基準の2軸で見る。 */

import { useEffect, useMemo, useState } from 'react';
import { Card, ScopeTag, Tabs } from '../../components/ui';
import { MonthNav } from '../app/Layout';
import { addMonths, currentMonthKey } from '../../lib/date';
import { formatAmount } from '../../lib/money';
import { loadTransactions, type Transaction } from '../../lib/db';
import { monthEnd, monthStart } from '../../lib/date';
import { useAuth, useWorkspace } from '../app/context';
import {
  SHARED_PAYER,
  aggregateMonth,
  categorySlices,
  monthDiff,
  type Basis,
  type ScopeFilter,
  type Slice,
} from './aggregate';
import { toAggregateTx } from '../app/model';

const MONTHS_IN_CHART = 6;

export function AggregatePage() {
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [scopeValue, setScopeValue] = useState<'all' | 'own' | string>('all');
  const [basis, setBasis] = useState<Basis>('burden');
  /** 内訳を開いている大分類（§5.4） */
  const [expanded, setExpanded] = useState<string[]>([]);
  const toggleExpanded = (categoryId: string) =>
    setExpanded((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    );
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

  // 内訳の開け閉てのたびに数え直さない（8か月ぶんの集計になる）
  const { totals, previous, history } = useMemo(() => {
    const common = {
      transactions: toAggregateTx(rows, workspace.categories),
      scope,
      basis,
      selfId,
      members,
    };
    return {
      totals: aggregateMonth({ ...common, monthKey }),
      previous: aggregateMonth({ ...common, monthKey: addMonths(monthKey, -1) }),
      history: Array.from({ length: MONTHS_IN_CHART }, (_, i) => {
        const key = addMonths(monthKey, -(MONTHS_IN_CHART - 1 - i));
        return { key, total: aggregateMonth({ ...common, monthKey: key }).expense };
      }),
    };
    // scope は毎回作り直されるオブジェクトなので、中身で見る
  }, [rows, workspace.categories, scopeValue, basis, selfId, members, monthKey]);

  const slices = categorySlices(totals.byCategory);
  const colorOf = new Map(slices.map((slice) => [slice.key, slice.colorIndex]));
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
        <div className="flex flex-wrap items-center gap-4">
          {slices.length > 1 && <CategoryPie slices={slices} />}
          <ul className="flex min-w-[16rem] flex-1 flex-col gap-1">
            {totals.byCategory.map((row) => {
              const slice = colorOf.get(row.categoryId);
              const open = expanded.includes(row.categoryId);
              return (
                <li key={row.categoryId} className="flex flex-col text-sm">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: `var(--c-cat-${slice ?? 7})` }}
                      />
                      <ScopeTag
                        label={
                          row.shareGroupId === null ? '個人' : workspace.groupName(row.shareGroupId)
                        }
                        kind={row.shareGroupId === null ? 'own' : 'group'}
                      />
                      {row.name}
                      {/* 小分類の取引があるときだけ内訳を開ける（§5.4） */}
                      {row.children.length > 0 && (
                        <button
                          type="button"
                          aria-label={`${row.name}の内訳`}
                          aria-expanded={open}
                          className="text-xs text-[var(--c-muted)]"
                          onClick={() => toggleExpanded(row.categoryId)}
                        >
                          {open ? '▲' : '▼'}
                        </button>
                      )}
                    </span>
                    <span className="tabular-nums">{formatAmount(row.amount)}</span>
                  </div>
                  {open && (
                    <ul className="mt-1 flex flex-col gap-1 pl-6 text-xs text-[var(--c-ink-soft)]">
                      {row.children.map((child) => (
                        <li
                          key={child.categoryId}
                          className="flex items-center justify-between"
                        >
                          <span>{child.name}</span>
                          <span className="tabular-nums">{formatAmount(child.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-bold">月次の推移</h2>
        <div className="flex h-24 gap-2">
          {history.map((month) => (
            <div key={month.key} className="flex h-full flex-1 flex-col items-center gap-1">
              {/* 棒の高さは % で出すので、棒を入れる枠にも高さが要る */}
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t bg-[var(--c-bar)]"
                  style={{ height: `${(month.total / peak) * 100}%` }}
                  title={`${month.key} ${formatAmount(month.total)}`}
                />
              </div>
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

/** カテゴリ別の内訳の円グラフ。1件しかない月は輪が1周するだけなので、呼ぶ側で出さない。割合は隣の一覧の金額で裏取りできるので、図には数字を載せない。 */
function CategoryPie({ slices }: { slices: Slice[] }) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const gap = 1.5; // 隣り合う扇のあいだに地の色を覗かせる
  let offset = 0;

  return (
    <svg viewBox="0 0 100 100" role="img" aria-label="カテゴリ別の内訳" className="mx-auto size-32 shrink-0">
      <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--c-bar-track)" strokeWidth="12" />
      {slices.map((slice) => {
        const length = slice.ratio * circumference;
        const dash = Math.max(length - gap, 0.5);
        const start = offset;
        offset += length;
        return (
          <circle
            key={slice.key}
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={`var(--c-cat-${slice.colorIndex})`}
            strokeWidth="12"
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-start}
            transform="rotate(-90 50 50)"
          >
            <title>{`${slice.name} ${Math.round(slice.ratio * 100)}%`}</title>
          </circle>
        );
      })}
    </svg>
  );
}
