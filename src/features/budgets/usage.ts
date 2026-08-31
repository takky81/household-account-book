/**
 * 予算の消化（docs/仕様書.md §5.6）。決定表「予算」に対応する。
 *
 * 実績は集計基準によらず、そのカテゴリの対象月の支出総額を使う。共有カテゴリの予算は
 * 共同の枠であり、負担額基準にすると枠が人数分に割れて意味を失うため。
 * 自分の負担は参考値として併記する（消化率には使わない）。
 */

import type { CategoryLike } from '../categories/name';

export type Usage = { rate: number | null; remaining: number | null; over: boolean };

export function budgetUsage(budget: number | null, actual: number): Usage {
  if (budget === null) return { rate: null, remaining: null, over: false };
  return { rate: actual / budget, remaining: budget - actual, over: actual > budget };
}

export type BudgetRow = {
  categoryId: string;
  name: string;
  shareGroupId: string | null;
  ownerId: string | null;
  budget: number | null;
  actual: number;
  selfBurden: number;
} & Usage;

export function buildBudgetRows(input: {
  categories: CategoryLike[];
  budgets: { categoryId: string; amount: number }[];
  actuals: Record<string, number>;
  selfBurden: Record<string, number>;
}): BudgetRow[] {
  const amountOf = new Map(input.budgets.map((b) => [b.categoryId, b.amount]));
  return input.categories
    // 予算は支出のみを対象とする。収入カテゴリには置けない
    .filter((c) => c.kind === 'expense')
    .map((c) => {
      const budget = amountOf.get(c.id) ?? null;
      const actual = input.actuals[c.id] ?? 0;
      return {
        categoryId: c.id,
        name: c.name,
        shareGroupId: c.shareGroupId,
        ownerId: c.ownerId,
        budget,
        actual,
        selfBurden: input.selfBurden[c.id] ?? 0,
        ...budgetUsage(budget, actual),
      };
    });
}

export type ScopeTotal = {
  shareGroupId: string | null;
  ownerId: string | null;
  budget: number;
  actual: number;
  remaining: number;
};

/** 共有範囲ごとの合計（列11）。共有範囲全体の予算という行は持たないため、ここで足す。 */
export function scopeTotals(rows: BudgetRow[]): ScopeTotal[] {
  const totals = new Map<string, ScopeTotal>();
  for (const row of rows) {
    const key = row.shareGroupId !== null ? `group:${row.shareGroupId}` : `own:${row.ownerId}`;
    const found = totals.get(key) ?? {
      shareGroupId: row.shareGroupId,
      ownerId: row.ownerId,
      budget: 0,
      actual: 0,
      remaining: 0,
    };
    found.budget += row.budget ?? 0;
    found.actual += row.actual;
    found.remaining = found.budget - found.actual;
    totals.set(key, found);
  }
  return [...totals.values()];
}
