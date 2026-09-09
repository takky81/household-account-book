/**
 * 予算の消化（docs/仕様書.md §5.6）。決定表「予算」に対応する。
 *
 * 実績は集計基準によらず、そのカテゴリの対象月の支出総額を使う。共有の予算は
 * 共同の枠であり、負担額基準にすると枠が人数分に割れて意味を失うため。
 * 自分の負担は参考値として併記する（消化率には使わない）。
 *
 * 予算は（カテゴリ, 共有範囲, 対象月）で1件（§3.7）。カテゴリは全ユーザー共通なので、
 * 同じ「食費」に共有の枠と個人の枠が並ぶ。画面は共有範囲を1つ選んで表を作る。
 */

import type { CategoryLike } from '../categories/name';

export type Usage = { rate: number | null; remaining: number | null; over: boolean };

export function budgetUsage(budget: number | null, actual: number): Usage {
  if (budget === null) return { rate: null, remaining: null, over: false };
  return { rate: actual / budget, remaining: budget - actual, over: actual > budget };
}

export type BudgetChild = { categoryId: string; name: string; actual: number };

export type BudgetRow = {
  categoryId: string;
  name: string;
  budget: number | null;
  /** 配下の小分類を含む実績（§5.6） */
  actual: number;
  selfBurden: number;
  /** 小分類ごとの実績。実績のある小分類だけを多い順に並べる */
  children: BudgetChild[];
} & Usage;

export function buildBudgetRows(input: {
  categories: CategoryLike[];
  budgets: { categoryId: string; amount: number }[];
  actuals: Record<string, number>;
  selfBurden: Record<string, number>;
}): BudgetRow[] {
  const amountOf = new Map(input.budgets.map((b) => [b.categoryId, b.amount]));
  // 親ごとの小分類を1回の走査でまとめる（行ごとに絞り込むと件数の2乗になる）
  const byParent = new Map<string, CategoryLike[]>();
  for (const category of input.categories) {
    if (category.parentId === null) continue;
    const found = byParent.get(category.parentId);
    if (found === undefined) byParent.set(category.parentId, [category]);
    else found.push(category);
  }

  return input.categories
    // 予算は支出の大分類にだけ置く。収入カテゴリと小分類は行に出さない（§3.7）
    .filter((c) => c.kind === 'expense' && c.parentId === null)
    .map((c) => {
      const budget = amountOf.get(c.id) ?? null;
      const kids = byParent.get(c.id) ?? [];
      const children = kids
        .map((child) => ({
          categoryId: child.id,
          name: child.name,
          actual: input.actuals[child.id] ?? 0,
        }))
        .filter((child) => child.actual > 0)
        .sort((a, b) => b.actual - a.actual);
      // 実績・自分の負担は、大分類そのものの分と配下の小分類の合計（§5.6）
      const actual =
        (input.actuals[c.id] ?? 0) + children.reduce((sum, child) => sum + child.actual, 0);
      const selfBurden =
        (input.selfBurden[c.id] ?? 0) +
        kids.reduce((sum, child) => sum + (input.selfBurden[child.id] ?? 0), 0);
      return {
        categoryId: c.id,
        name: c.name,
        budget,
        actual,
        selfBurden,
        children,
        ...budgetUsage(budget, actual),
      };
    });
}

export type BudgetTotal = { budget: number; actual: number; remaining: number };

/**
 * 表の合計（列11）。共有範囲全体の予算という行は持たないため、ここで足す。
 * 表は共有範囲1つぶんなので、合計も1行になる。
 */
export function budgetTotal(rows: BudgetRow[]): BudgetTotal {
  const budget = rows.reduce((sum, row) => sum + (row.budget ?? 0), 0);
  const actual = rows.reduce((sum, row) => sum + row.actual, 0);
  return { budget, actual, remaining: budget - actual };
}

export type BudgetEntry = { categoryId: string; month: string; amount: number };

/** 予算として置ける金額か（列6）。予算なしは行が無いことで表すので、0円は作れない。 */
export function validateBudgetAmount(amount: number): { ok: true } | { ok: false; message: string } {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, message: '予算は1以上の整数にしてください' };
  }
  return { ok: true };
}

/** 同じカテゴリ・同じ対象月の予算は1件だけ。置き直すと上書きになる（列7）。 */
export function applyBudget(budgets: BudgetEntry[], entry: BudgetEntry): BudgetEntry[] {
  const rest = budgets.filter(
    (b) => !(b.categoryId === entry.categoryId && b.month === entry.month),
  );
  return [...rest, entry];
}

/**
 * 前月の予算を対象月に複製する（列9）。
 * 予算は月をまたいで繰り越さないので、複製は明示的な操作として用意する。
 * すでに当月にある予算は上書きしない。
 */
export function copyBudgets(
  previous: BudgetEntry[],
  monthKey: string,
  current: BudgetEntry[] = [],
): BudgetEntry[] {
  const taken = new Set(current.map((b) => b.categoryId));
  return previous
    .filter((b) => !taken.has(b.categoryId))
    .map((b) => ({ categoryId: b.categoryId, month: `${monthKey}-01`, amount: b.amount }));
}
