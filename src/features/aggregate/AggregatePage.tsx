/** 集計画面（決定表「集計」）。対象範囲 × 集計基準の2軸で見る。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Select, Tabs } from '../../components/ui';
import { MonthNav } from '../app/Layout';
import { addMonths } from '../../lib/date';
import { formatAmount } from '../../lib/money';
import { loadTransactions, type Transaction } from '../../lib/db';
import { monthEnd, monthStart } from '../../lib/date';
import { useAuth, useWorkspace } from '../app/context';
import {
  SHARED_PAYER,
  aggregateMonth,
  categorySlices,
  monthDiff,
  monthlyCategoryChart,
  type Basis,
  type MonthlyCategoryBar,
  type MonthlyCategorySeries,
  type ScopeFilter,
  type Slice,
} from './aggregate';
import { toAggregateTx } from '../app/model';
import { useTargetMonth } from '../app/targetMonth';

const MONTHS_IN_CHART = 6;

export function AggregatePage() {
  const workspace = useWorkspace();
  const { userId } = useAuth();
  const selfId = userId!;
  const { monthKey, setMonthKey } = useTargetMonth();
  const [scopeValue, setScopeValue] = useState<'all' | 'own' | string>('all');
  const [basis, setBasis] = useState<Basis>('burden');
  const [tagId, setTagId] = useState('');
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
      transactions: toAggregateTx(rows, workspace.categories, workspace.tags),
      scope,
      basis,
      selfId,
      members,
      tagId: tagId === '' ? null : tagId,
    };
    return {
      totals: aggregateMonth({ ...common, monthKey }),
      previous: aggregateMonth({ ...common, monthKey: addMonths(monthKey, -1) }),
      history: Array.from({ length: MONTHS_IN_CHART }, (_, i) => {
        const key = addMonths(monthKey, -(MONTHS_IN_CHART - 1 - i));
        return { key, totals: aggregateMonth({ ...common, monthKey: key }) };
      }),
    };
    // scope は毎回作り直されるオブジェクトなので、中身で見る
  }, [rows, workspace.categories, workspace.tags, scopeValue, basis, tagId, selfId, members, monthKey]);

  const slices = categorySlices(totals.byCategory);
  const colorOf = new Map(slices.map((slice) => [slice.key, slice.colorIndex]));
  const monthlyChart = monthlyCategoryChart(
    history.map((month) => ({ key: month.key, rows: month.totals.byCategory })),
    totals.byCategory,
  );

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

      <label className="flex items-center gap-2 text-sm">
        <span>タグ</span>
        <Select value={tagId} onChange={(event) => setTagId(event.target.value)}>
          <option value="">すべて</option>
          {workspace.tags.map((tag) => (
            <option key={tag.id} value={tag.id}>{tag.name}</option>
          ))}
        </Select>
      </label>

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
          <ul className="flex min-w-[16rem] flex-1 flex-col gap-1" data-testid="category-breakdown">
            {totals.byCategory.map((row) => {
              const slice = colorOf.get(row.key);
              const open = expanded.includes(row.key);
              return (
                <li key={row.key} className="flex flex-col text-sm">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: `var(--c-cat-${slice ?? 7})` }}
                        data-category-key={row.key}
                        data-color-index={slice ?? 7}
                      />
                      {row.name}
                      {/* 小分類の取引があるときだけ内訳を開ける（§5.4） */}
                      {row.children.length > 0 && (
                        <button
                          type="button"
                          aria-label={`${row.name}の内訳`}
                          aria-expanded={open}
                          className="text-xs text-[var(--c-muted)]"
                          onClick={() => toggleExpanded(row.key)}
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
        <h2 className="mb-2 text-sm font-bold">タグ別の内訳</h2>
        {totals.byTag.length === 0 ? (
          <p className="text-xs text-[var(--c-muted)]">タグ付きの支出はありません</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {totals.byTag.map((row) => {
              const tag = workspace.tags.find((item) => item.id === row.tagId);
              return (
                <li key={row.tagId} className="flex justify-between text-sm">
                  <span className="flex items-center gap-1">
                    <span className="size-2.5 rounded-full" style={{ background: tag?.color }} />
                    {row.name}
                  </span>
                  <span className="tabular-nums">{formatAmount(row.amount)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-[var(--c-muted)]">
          複数タグの取引はそれぞれに全額を数えるため、タグ別金額は合計できません
        </p>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-bold">月次の推移</h2>
        <MonthlyCategoryTrend series={monthlyChart.series} months={monthlyChart.months} />
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

/** カテゴリ別の積み上げ棒。各色の上端を点線で結び、月ごとの増減を追えるようにする。 */
function MonthlyCategoryTrend({
  series,
  months,
}: {
  series: MonthlyCategorySeries[];
  months: MonthlyCategoryBar[];
}) {
  const DEFAULT_HEIGHT = 192;
  const MIN_HEIGHT = 96;
  const MAX_HEIGHT = 480;
  const width = 600;
  const plotBottom = 100;
  const plotHeight = plotBottom;
  const step = width / Math.max(months.length, 1);
  const barWidth = Math.min(56, step * 0.58);
  const peak = Math.max(1, ...months.map((month) => month.total));
  const centerOf = (index: number) => step * index + step / 2;
  const yOf = (amount: number) => plotBottom - (amount / peak) * plotHeight;
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const drag = useRef<{ source: 'mouse' | 'touch'; y: number; height: number } | null>(null);
  const clampHeight = (next: number) => Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, next));

  useEffect(() => {
    const moveMouse = (event: MouseEvent) => {
      const start = drag.current;
      if (start === null || start.source !== 'mouse') return;
      setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, start.height + event.clientY - start.y)));
    };
    const moveTouch = (event: TouchEvent) => {
      const start = drag.current;
      const touch = event.touches[0];
      if (start === null || start.source !== 'touch' || touch === undefined) return;
      event.preventDefault();
      setHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, start.height + touch.clientY - start.y)));
    };
    const stopMouse = () => {
      if (drag.current?.source === 'mouse') drag.current = null;
    };
    const stopTouch = () => {
      if (drag.current?.source === 'touch') drag.current = null;
    };
    window.addEventListener('mousemove', moveMouse);
    window.addEventListener('mouseup', stopMouse);
    window.addEventListener('touchmove', moveTouch, { passive: false });
    window.addEventListener('touchend', stopTouch);
    window.addEventListener('touchcancel', stopTouch);
    return () => {
      window.removeEventListener('mousemove', moveMouse);
      window.removeEventListener('mouseup', stopMouse);
      window.removeEventListener('touchmove', moveTouch);
      window.removeEventListener('touchend', stopTouch);
      window.removeEventListener('touchcancel', stopTouch);
    };
  }, []);

  return (
    <div data-testid="monthly-category-chart">
      <div style={{ height }} data-testid="monthly-category-plot">
        <svg
          viewBox={`0 0 ${width} ${plotBottom}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="カテゴリ別の月次推移"
          className="size-full"
        >
          {months.flatMap((month, monthIndex) => {
            let bottom = 0;
            return month.amounts.map((amount, seriesIndex) => {
              const next = bottom + amount;
              const y = yOf(next);
              const segmentHeight = yOf(bottom) - y;
              bottom = next;
              const item = series[seriesIndex]!;
              return (
                <rect
                  key={`${month.key}-${item.key}`}
                  x={centerOf(monthIndex) - barWidth / 2}
                  y={y}
                  width={barWidth}
                  height={segmentHeight}
                  fill={`var(--c-cat-${item.colorIndex})`}
                  data-testid="monthly-category-segment"
                  data-month={month.key}
                  data-category-key={item.key}
                  data-color-index={item.colorIndex}
                  aria-label={`${month.key} ${item.name} ${formatAmount(amount)}`}
                />
              );
            });
          })}

          {/* 積み上げた各カテゴリの上端を、隣の月まで点線でつなぐ。 */}
          {series.flatMap((item, seriesIndex) =>
            months.slice(0, -1).map((month, monthIndex) => {
              const nextMonth = months[monthIndex + 1]!;
              const from = month.boundaries[seriesIndex] ?? 0;
              const to = nextMonth.boundaries[seriesIndex] ?? 0;
              if (from === 0 && to === 0) return null;
              return (
                <line
                  key={`${item.key}-${month.key}`}
                  x1={centerOf(monthIndex) + barWidth / 2}
                  y1={yOf(from)}
                  x2={centerOf(monthIndex + 1) - barWidth / 2}
                  y2={yOf(to)}
                  stroke="var(--c-muted)"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                  data-testid="monthly-category-boundary"
                />
              );
            }),
          )}
        </svg>
      </div>

      <div className="flex" aria-hidden="true">
        {months.map((month) => (
          <span
            key={month.key}
            className="flex-1 text-center text-[10px] text-[var(--c-muted)]"
          >
            {month.key.slice(5)}
          </span>
        ))}
      </div>

      <button
        type="button"
        role="separator"
        aria-label="月次推移の高さを変更"
        aria-orientation="horizontal"
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={MAX_HEIGHT}
        aria-valuenow={height}
        className="mt-1 flex min-h-6 w-full cursor-ns-resize touch-none items-center justify-center rounded text-[var(--c-muted)] hover:bg-[var(--c-subtle)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--c-ink)]"
        onMouseDown={(event) => {
          event.preventDefault();
          drag.current = { source: 'mouse', y: event.clientY, height };
        }}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (touch !== undefined) drag.current = { source: 'touch', y: touch.clientY, height };
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          setHeight((current) => clampHeight(current + (event.key === 'ArrowUp' ? -16 : 16)));
        }}
      >
        <span aria-hidden="true">•••</span>
      </button>
    </div>
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
